//! X bookmarks (SPECs/x-bookmarks-spec.md): sign in to X with the user's own
//! developer app (OAuth 2.0 + PKCE, tokens in the Keychain), list new
//! bookmarks, gather each author's thread, and download media beside a note.
//! The frontend owns the notes; this module owns everything that talks to X.

use crate::error::AppError;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

const API: &str = "https://api.x.com/2";
const AUTHORIZE_URL: &str = "https://x.com/i/oauth2/authorize";
const TOKEN_URL: &str = "https://api.x.com/2/oauth2/token";
const CALLBACK_PORT: u16 = 47863;
pub const REDIRECT_URI: &str = "http://127.0.0.1:47863/x/callback";
const SCOPES: &str = "tweet.read users.read bookmark.read offline.access";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// X returns at most the 800 most recent bookmarks.
const MAX_BOOKMARKS: usize = 800;
const PAGE_SIZE: &str = "20";
const MAX_THREAD_POSTS: usize = 50;
const MAX_MEDIA_BYTES: u64 = 500 * 1024 * 1024;
const SAVED_IDS_FILE: &str = "x-bookmarks-saved.json";

const POST_FIELDS: &str =
    "attachments,author_id,conversation_id,created_at,display_text_range,entities,id,note_post,public_metrics,referenced_posts,text";
const EXPANSIONS: &str = "attachments.media_keys,author_id,referenced_posts";
const MEDIA_FIELDS: &str =
    "alt_text,duration_ms,height,media_key,preview_image_url,type,url,variants,width";
const USER_FIELDS: &str = "id,name,username";

/// Every call to X goes through this lock: X rotates refresh tokens, so two
/// refreshes with the same token would sign the user out.
static X_LOCK: LazyLock<tokio::sync::Mutex<()>> = LazyLock::new(|| tokio::sync::Mutex::new(()));

// ---------------------------------------------------------------------------
// What the frontend gets

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XAccount {
    pub username: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XMedia {
    /// "photo", "video" or "gif".
    pub kind: String,
    /// The file to download: the photo itself, or the best MP4.
    pub url: String,
    pub poster: Option<String>,
    pub duration_ms: Option<u64>,
    pub alt: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XQuote {
    pub author_name: Option<String>,
    pub author_handle: Option<String>,
    pub text: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XPost {
    pub id: String,
    pub text: String,
    pub media: Vec<XMedia>,
    pub quote: Option<XQuote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct XBookmark {
    pub id: String,
    pub url: String,
    pub author_id: String,
    pub author_name: String,
    pub author_handle: String,
    pub conversation_id: String,
    pub posted_at: String,
    /// Whether the author may have replied to themselves under this post, so
    /// `x_expand_thread` has something to look for.
    pub may_have_thread: bool,
    pub posts: Vec<XPost>,
}

// ---------------------------------------------------------------------------
// Raw API shapes. X renamed "tweet" to "post" in 2026; aliases keep the old
// names working if a response still uses them.

#[derive(Debug, Clone, Deserialize, Default)]
struct RawPost {
    id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    author_id: Option<String>,
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    display_text_range: Option<[usize; 2]>,
    #[serde(default, alias = "note_tweet")]
    note_post: Option<RawNote>,
    #[serde(default)]
    entities: Option<RawEntities>,
    #[serde(default)]
    attachments: Option<RawAttachments>,
    #[serde(default, alias = "referenced_tweets")]
    referenced_posts: Vec<RawRef>,
    #[serde(default)]
    public_metrics: Option<RawMetrics>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawNote {
    text: String,
    #[serde(default)]
    entities: Option<RawEntities>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawEntities {
    #[serde(default)]
    urls: Vec<RawUrl>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawUrl {
    url: String,
    #[serde(default)]
    expanded_url: Option<String>,
    #[serde(default)]
    media_key: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawAttachments {
    #[serde(default)]
    media_keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawRef {
    #[serde(rename = "type")]
    kind: String,
    id: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawMetrics {
    #[serde(default)]
    reply_count: u64,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawMedia {
    media_key: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    preview_image_url: Option<String>,
    #[serde(default)]
    duration_ms: Option<u64>,
    #[serde(default)]
    alt_text: Option<String>,
    #[serde(default)]
    variants: Vec<RawVariant>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawVariant {
    #[serde(default)]
    bit_rate: Option<u64>,
    #[serde(default)]
    content_type: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct RawUser {
    id: String,
    name: String,
    username: String,
}

#[derive(Debug, Deserialize, Default)]
struct RawIncludes {
    #[serde(default)]
    media: Vec<RawMedia>,
    #[serde(default)]
    users: Vec<RawUser>,
    #[serde(default, alias = "tweets")]
    posts: Vec<RawPost>,
}

#[derive(Debug, Deserialize, Default)]
struct RawMeta {
    #[serde(default)]
    next_token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawList {
    #[serde(default)]
    data: Vec<RawPost>,
    #[serde(default)]
    includes: RawIncludes,
    #[serde(default)]
    meta: RawMeta,
}

#[derive(Debug, Deserialize)]
struct RawOne {
    data: Option<RawPost>,
    #[serde(default)]
    includes: RawIncludes,
}

/// Lookups for one response's expansions.
#[derive(Default)]
struct Includes {
    media: HashMap<String, RawMedia>,
    users: HashMap<String, RawUser>,
    posts: HashMap<String, RawPost>,
}

impl Includes {
    fn add(&mut self, raw: RawIncludes) {
        self.media
            .extend(raw.media.into_iter().map(|m| (m.media_key.clone(), m)));
        self.users
            .extend(raw.users.into_iter().map(|u| (u.id.clone(), u)));
        self.posts
            .extend(raw.posts.into_iter().map(|p| (p.id.clone(), p)));
    }
}

// ---------------------------------------------------------------------------
// Pure helpers

fn post_url(handle: &str, id: &str) -> String {
    format!("https://x.com/{handle}/status/{id}")
}

fn decode_entities(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The post's readable text: the long-form text when it has one, leading
/// reply mentions cut by `display_text_range`, `t.co` links swapped for where
/// they go, and links to the post's own media or quoted post removed (those
/// are shown as media and a quote card).
fn clean_text(post: &RawPost, quoted_id: Option<&str>) -> String {
    let (raw, entities, range) = match &post.note_post {
        Some(note) => (note.text.as_str(), note.entities.as_ref(), None),
        None => (
            post.text.as_str(),
            post.entities.as_ref(),
            post.display_text_range,
        ),
    };
    let mut text: String = match range {
        Some([start, end]) if start <= end => raw.chars().skip(start).take(end - start).collect(),
        _ => raw.to_string(),
    };
    for link in entities.map(|e| e.urls.as_slice()).unwrap_or_default() {
        let expanded = link.expanded_url.as_deref().unwrap_or("");
        let own_media = link.media_key.is_some()
            || (expanded.contains(&format!("/status/{}/", post.id))
                && (expanded.contains("/photo/") || expanded.contains("/video/")));
        let is_quote = quoted_id.is_some_and(|q| {
            expanded.ends_with(&format!("/status/{q}"))
                || expanded.contains(&format!("/status/{q}?"))
        });
        let replacement = if own_media || is_quote || expanded.is_empty() {
            ""
        } else {
            expanded
        };
        text = text.replace(&link.url, replacement);
    }
    decode_entities(text.trim())
}

/// The MP4 with the highest bit rate (GIFs report 0), else any MP4.
fn best_mp4(variants: &[RawVariant]) -> Option<String> {
    variants
        .iter()
        .filter(|v| v.content_type.as_deref() == Some("video/mp4") && v.url.is_some())
        .max_by_key(|v| v.bit_rate.unwrap_or(0))
        .and_then(|v| v.url.clone())
}

fn to_media(raw: &RawMedia) -> Option<XMedia> {
    let (kind, url) = match raw.kind.as_str() {
        "photo" => ("photo", photo_url(raw.url.as_deref()?)),
        "video" => ("video", best_mp4(&raw.variants)?),
        "animated_gif" => ("gif", best_mp4(&raw.variants)?),
        _ => return None,
    };
    Some(XMedia {
        kind: kind.into(),
        url,
        poster: raw.preview_image_url.clone(),
        duration_ms: raw.duration_ms,
        alt: raw.alt_text.clone().filter(|a| !a.trim().is_empty()),
    })
}

/// X serves photos at several sizes; `name=large` is the biggest that is
/// always there.
fn photo_url(url: &str) -> String {
    if url.contains("pbs.twimg.com") && !url.contains('?') {
        format!("{url}?name=large")
    } else {
        url.to_string()
    }
}

fn reference<'a>(post: &'a RawPost, kind: &str) -> Option<&'a str> {
    post.referenced_posts
        .iter()
        .find(|r| r.kind == kind)
        .map(|r| r.id.as_str())
}

fn to_post(raw: &RawPost, inc: &Includes) -> XPost {
    let quoted_id = reference(raw, "quoted");
    let media = raw
        .attachments
        .as_ref()
        .map(|a| {
            a.media_keys
                .iter()
                .filter_map(|k| inc.media.get(k))
                .filter_map(to_media)
                .collect()
        })
        .unwrap_or_default();
    let quote = quoted_id.map(|qid| {
        let quoted = inc.posts.get(qid);
        let author = quoted
            .and_then(|q| q.author_id.as_ref())
            .and_then(|a| inc.users.get(a));
        let handle = author.map(|a| a.username.clone());
        XQuote {
            author_name: author.map(|a| a.name.clone()),
            text: quoted.map(|q| clean_text(q, None)).unwrap_or_default(),
            url: post_url(handle.as_deref().unwrap_or("i"), qid),
            author_handle: handle,
        }
    });
    XPost {
        id: raw.id.clone(),
        text: clean_text(raw, quoted_id),
        media,
        quote,
    }
}

fn to_bookmark(raw: &RawPost, inc: &Includes) -> Option<XBookmark> {
    let author_id = raw.author_id.clone()?;
    let author = inc.users.get(&author_id)?;
    let conversation_id = raw
        .conversation_id
        .clone()
        .unwrap_or_else(|| raw.id.clone());
    let is_root = conversation_id == raw.id;
    let replies = raw.public_metrics.as_ref().map_or(0, |m| m.reply_count);
    Some(XBookmark {
        id: raw.id.clone(),
        url: post_url(&author.username, &raw.id),
        author_id,
        author_name: author.name.clone(),
        author_handle: author.username.clone(),
        conversation_id,
        posted_at: raw.created_at.clone().unwrap_or_default(),
        may_have_thread: !is_root || replies > 0,
        posts: vec![to_post(raw, inc)],
    })
}

fn id_number(id: &str) -> u128 {
    id.parse().unwrap_or(0)
}

/// The author's own chain from the root: each post replying to one already
/// in the chain, in posting order.
fn thread_chain<'a>(root_id: &str, author_id: &str, posts: &'a [RawPost]) -> Vec<&'a RawPost> {
    let mut sorted: Vec<&RawPost> = posts.iter().collect();
    sorted.sort_by_key(|p| id_number(&p.id));
    sorted.dedup_by(|a, b| a.id == b.id);
    let mut chain: Vec<&RawPost> = Vec::new();
    let mut in_chain: HashSet<&str> = HashSet::new();
    for post in sorted {
        if post.author_id.as_deref() != Some(author_id) {
            continue;
        }
        let joins = if post.id == root_id {
            true
        } else {
            reference(post, "replied_to").is_some_and(|parent| in_chain.contains(parent))
        };
        if joins {
            in_chain.insert(post.id.as_str());
            chain.push(post);
            if chain.len() == MAX_THREAD_POSTS {
                break;
            }
        }
    }
    chain
}

fn pkce_pair() -> (String, String) {
    let verifier = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

fn authorize_url(client_id: &str, state: &str, challenge: &str) -> String {
    let mut url = reqwest::Url::parse(AUTHORIZE_URL).expect("valid constant");
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    url.into()
}

/// The `code` from the browser's redirect request line, after checking
/// `state`. Errors carry the message the browser page and the app show.
fn parse_callback(request_line: &str, expected_state: &str) -> Result<String, String> {
    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let url = reqwest::Url::parse(&format!("http://127.0.0.1{target}"))
        .map_err(|_| "X sent back an address Pensée couldn't read.".to_string())?;
    if url.path() != "/x/callback" {
        return Err("not the callback".into());
    }
    let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
    if let Some(error) = params.get("error") {
        return Err(if error == "access_denied" {
            "You didn't allow Pensée to read your bookmarks.".into()
        } else {
            format!("X refused the sign-in ({error}).")
        });
    }
    if params.get("state").map(String::as_str) != Some(expected_state) {
        return Err("The sign-in didn't come from this Pensée window. Try Connect X again.".into());
    }
    params
        .get("code")
        .cloned()
        .ok_or_else(|| "X didn't send a sign-in code.".into())
}

fn form_body(pairs: &[(&str, &str)]) -> String {
    let mut form = url::form_urlencoded::Serializer::new(String::new());
    for (k, v) in pairs {
        form.append_pair(k, v);
    }
    form.finish()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_secs())
}

// ---------------------------------------------------------------------------
// Tokens in the Keychain

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Tokens {
    client_id: String,
    access_token: String,
    refresh_token: Option<String>,
    expires_at: u64,
    user_id: String,
    username: String,
    name: String,
}

#[cfg(target_os = "macos")]
mod keychain {
    use super::Tokens;
    use crate::error::AppError;
    use security_framework::passwords;

    const SERVICE: &str = "Writer X Bookmarks";
    const ACCOUNT: &str = "oauth";
    const NOT_FOUND: i32 = -25300;

    pub fn load() -> Result<Option<Tokens>, AppError> {
        match passwords::get_generic_password(SERVICE, ACCOUNT) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|e| AppError::Io(format!("X sign-in in the Keychain is unreadable: {e}"))),
            Err(e) if e.code() == NOT_FOUND => Ok(None),
            Err(e) => Err(AppError::Io(format!("Keychain: {e}"))),
        }
    }

    pub fn save(tokens: &Tokens) -> Result<(), AppError> {
        let bytes = serde_json::to_vec(tokens).map_err(|e| AppError::Io(e.to_string()))?;
        passwords::set_generic_password(SERVICE, ACCOUNT, &bytes)
            .map_err(|e| AppError::Io(format!("Keychain: {e}")))
    }

    pub fn delete() -> Result<(), AppError> {
        match passwords::delete_generic_password(SERVICE, ACCOUNT) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == NOT_FOUND => Ok(()),
            Err(e) => Err(AppError::Io(format!("Keychain: {e}"))),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod keychain {
    use super::Tokens;
    use crate::error::AppError;

    fn unsupported() -> AppError {
        AppError::User("X bookmarks need macOS for now.".into())
    }
    pub fn load() -> Result<Option<Tokens>, AppError> {
        Ok(None)
    }
    pub fn save(_: &Tokens) -> Result<(), AppError> {
        Err(unsupported())
    }
    pub fn delete() -> Result<(), AppError> {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// HTTP

fn api_client() -> Result<&'static reqwest::Client, AppError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .user_agent("Pensee (X bookmarks)")
        .build()
        .map_err(|e| AppError::Network(e.to_string()))?;
    Ok(CLIENT.get_or_init(|| client))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

async fn post_token(body: String) -> Result<TokenResponse, AppError> {
    let response = api_client()?
        .post(TOKEN_URL)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    if !status.is_success() {
        eprintln!("[x-bookmarks] x token request failed: {status} {text}");
        return Err(if status.as_u16() == 400 || status.as_u16() == 401 {
            AppError::User("X signed you out. Reconnect X in Settings → X Bookmarks.".into())
        } else {
            AppError::Network(format!("X sign-in failed ({status})."))
        });
    }
    serde_json::from_str(&text).map_err(|e| AppError::Network(e.to_string()))
}

/// A usable access token, refreshing (and saving the rotated pair) first when
/// it is about to expire. Callers hold `X_LOCK`.
async fn fresh_tokens() -> Result<Tokens, AppError> {
    let mut tokens = keychain::load()?
        .ok_or_else(|| AppError::User("Connect X in Settings → X Bookmarks first.".into()))?;
    if tokens.expires_at > now_secs() + 60 {
        return Ok(tokens);
    }
    let refresh = tokens.refresh_token.clone().ok_or_else(|| {
        AppError::User("X signed you out. Reconnect X in Settings → X Bookmarks.".into())
    })?;
    let response = post_token(form_body(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &refresh),
        ("client_id", &tokens.client_id),
    ]))
    .await?;
    tokens.access_token = response.access_token;
    tokens.refresh_token = response.refresh_token.or(tokens.refresh_token);
    tokens.expires_at = now_secs() + response.expires_in.unwrap_or(7200);
    keychain::save(&tokens)?;
    Ok(tokens)
}

#[derive(Debug)]
enum GetError {
    /// The account or app may not use this endpoint (403), or it's gone (404).
    Refused(u16),
    App(AppError),
}

impl From<AppError> for GetError {
    fn from(e: AppError) -> Self {
        GetError::App(e)
    }
}

impl From<GetError> for AppError {
    fn from(e: GetError) -> Self {
        match e {
            GetError::Refused(status) => {
                AppError::Network(format!("X refused the request ({status})."))
            }
            GetError::App(e) => e,
        }
    }
}

async fn get_json<T: serde::de::DeserializeOwned>(
    tokens: &Tokens,
    path: &str,
    params: &[(&str, &str)],
) -> Result<T, GetError> {
    let mut url = reqwest::Url::parse(&format!("{API}{path}"))
        .map_err(|e| AppError::InvalidUrl(e.to_string()))?;
    url.query_pairs_mut().extend_pairs(params);
    let response = api_client()?
        .get(url)
        .bearer_auth(&tokens.access_token)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?;
    match status.as_u16() {
        200..=299 => {}
        401 => {
            return Err(AppError::User(
                "X signed you out. Reconnect X in Settings → X Bookmarks.".into(),
            )
            .into())
        }
        402 => {
            return Err(AppError::User(
                "Your X developer account is out of credit. Add credit in the X Developer Console."
                    .into(),
            )
            .into())
        }
        429 => {
            return Err(AppError::User(
                "X asked Pensée to slow down. It will try again at the next sync.".into(),
            )
            .into())
        }
        code @ (403 | 404) => {
            eprintln!("[x-bookmarks] x GET {path} refused: {status} {text}");
            return Err(GetError::Refused(code));
        }
        _ => {
            eprintln!("[x-bookmarks] x GET {path} failed: {status} {text}");
            return Err(AppError::Network(format!("X didn't answer ({status}).")).into());
        }
    }
    serde_json::from_str(&text).map_err(|e| {
        eprintln!("[x-bookmarks] x GET {path}: unexpected response: {e}: {text}");
        GetError::App(AppError::Network(format!(
            "X sent something Pensée couldn't read: {e}"
        )))
    })
}

const POST_PARAMS: [(&str, &str); 4] = [
    ("post.fields", POST_FIELDS),
    ("expansions", EXPANSIONS),
    ("media.fields", MEDIA_FIELDS),
    ("user.fields", USER_FIELDS),
];

// ---------------------------------------------------------------------------
// Saved IDs: bookmarks already turned into notes for a vault, so deleting a
// note doesn't bring it back on the next sync. Kept in the app's data folder.

fn saved_ids_path(app: &tauri::AppHandle) -> Result<PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Io(e.to_string()))?
        .join(SAVED_IDS_FILE))
}

fn read_saved(path: &Path) -> HashMap<String, Vec<String>> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

fn add_saved(path: &Path, root: &str, ids: &[String]) -> Result<(), AppError> {
    let mut all = read_saved(path);
    let list = all.entry(root.to_string()).or_default();
    for id in ids {
        if !list.contains(id) {
            list.push(id.clone());
        }
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let bytes = serde_json::to_vec(&all).map_err(|e| AppError::Io(e.to_string()))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands

#[tauri::command]
pub async fn x_account() -> Result<Option<XAccount>, AppError> {
    Ok(keychain::load()?.map(|t| XAccount {
        username: t.username,
        name: t.name,
    }))
}

#[tauri::command]
pub async fn x_disconnect() -> Result<(), AppError> {
    let _guard = X_LOCK.lock().await;
    keychain::delete()
}

/// Sign in with the user's X app: open X's consent page in the browser and
/// wait for it to redirect back to the local callback.
#[tauri::command]
pub async fn x_connect(app: tauri::AppHandle, client_id: String) -> Result<XAccount, AppError> {
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return Err(AppError::User("Paste your X app's Client ID first.".into()));
    }
    let listener = TcpListener::bind(("127.0.0.1", CALLBACK_PORT)).map_err(|_| {
        AppError::User("Another Pensée window is connecting to X. Finish there first.".into())
    })?;
    listener.set_nonblocking(true)?;
    let (verifier, challenge) = pkce_pair();
    let state = uuid::Uuid::new_v4().simple().to_string();
    app.opener()
        .open_url(authorize_url(&client_id, &state, &challenge), None::<&str>)
        .map_err(|e| AppError::Io(e.to_string()))?;

    let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state))
        .await
        .map_err(|e| AppError::Io(e.to_string()))??;

    let _guard = X_LOCK.lock().await;
    let response = post_token(form_body(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", REDIRECT_URI),
        ("client_id", &client_id),
        ("code_verifier", &verifier),
    ]))
    .await?;
    let mut tokens = Tokens {
        client_id,
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: now_secs() + response.expires_in.unwrap_or(7200),
        user_id: String::new(),
        username: String::new(),
        name: String::new(),
    };
    #[derive(Deserialize)]
    struct Me {
        data: RawUser,
    }
    let me: Me = get_json(&tokens, "/users/me", &[("user.fields", USER_FIELDS)]).await?;
    tokens.user_id = me.data.id;
    tokens.username = me.data.username;
    tokens.name = me.data.name;
    keychain::save(&tokens)?;
    Ok(XAccount {
        username: tokens.username,
        name: tokens.name,
    })
}

fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, AppError> {
    let deadline = Instant::now() + SIGN_IN_TIMEOUT;
    loop {
        if Instant::now() > deadline {
            return Err(AppError::User(
                "X sign-in timed out. Click Connect X to try again.".into(),
            ));
        }
        let (mut stream, _) = match listener.accept() {
            Ok(conn) => conn,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.into()),
        };
        stream.set_nonblocking(false)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        let mut buf = [0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);
        let first_line = request.lines().next().unwrap_or("");
        let result = parse_callback(first_line, state);
        if matches!(&result, Err(msg) if msg == "not the callback") {
            // A favicon request or similar; keep waiting for the redirect.
            let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            continue;
        }
        let message = match &result {
            Ok(_) => "Pensée is connected to X. You can close this tab.".to_string(),
            Err(msg) => msg.clone(),
        };
        let body = format!(
            "<!doctype html><meta charset=utf-8><title>Pensée</title>\
             <body style=\"font:16px -apple-system,sans-serif;display:grid;place-items:center;height:90vh\">\
             <p>{message}</p></body>"
        );
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
            .as_bytes(),
        );
        return result.map_err(AppError::User);
    }
}

/// Bookmarks newer than any already saved for `root`, newest first. Paging
/// stops at the first known post. Each comes with just the bookmarked post;
/// `x_expand_thread` adds the rest of the author's thread.
#[tauri::command]
pub async fn x_list_new_bookmarks(
    app: tauri::AppHandle,
    root: String,
    known_ids: Vec<String>,
) -> Result<Vec<XBookmark>, AppError> {
    let mut known: HashSet<String> = known_ids.into_iter().collect();
    known.extend(
        read_saved(&saved_ids_path(&app)?)
            .remove(&root)
            .unwrap_or_default(),
    );

    let _guard = X_LOCK.lock().await;
    let mut tokens = fresh_tokens().await?;
    let path = format!("/users/{}/bookmarks", tokens.user_id);
    let mut found = Vec::new();
    let mut seen = 0;
    let mut next: Option<String> = None;
    loop {
        let mut params: Vec<(&str, &str)> = POST_PARAMS.to_vec();
        params.push(("max_results", PAGE_SIZE));
        if let Some(token) = &next {
            params.push(("pagination_token", token));
        }
        if tokens.expires_at <= now_secs() + 60 {
            tokens = fresh_tokens().await?;
        }
        let page: RawList = get_json(&tokens, &path, &params).await?;
        let mut inc = Includes::default();
        inc.add(page.includes);
        let mut hit_known = false;
        for raw in &page.data {
            seen += 1;
            if known.contains(&raw.id) {
                hit_known = true;
                break;
            }
            match to_bookmark(raw, &inc) {
                Some(bookmark) => found.push(bookmark),
                None => eprintln!(
                    "[x-bookmarks] x bookmark {} has no author in the response",
                    raw.id
                ),
            }
        }
        next = page.meta.next_token;
        if hit_known || next.is_none() || seen >= MAX_BOOKMARKS {
            break;
        }
    }
    Ok(found)
}

/// The author's whole thread around a bookmark. A bookmark that replies to
/// someone else, or whose thread can't be searched, comes back as it was.
#[tauri::command]
pub async fn x_expand_thread(bookmark: XBookmark) -> Result<XBookmark, AppError> {
    if !bookmark.may_have_thread {
        return Ok(bookmark);
    }
    let _guard = X_LOCK.lock().await;
    let tokens = fresh_tokens().await?;
    let mut inc = Includes::default();
    let mut posts: Vec<RawPost> = Vec::new();

    if bookmark.conversation_id != bookmark.id {
        let root: RawOne = match get_json(
            &tokens,
            &format!("/tweets/{}", bookmark.conversation_id),
            &POST_PARAMS,
        )
        .await
        {
            Ok(root) => root,
            Err(GetError::Refused(_)) => return Ok(bookmark),
            Err(GetError::App(e)) => return Err(e),
        };
        inc.add(root.includes);
        match root.data {
            Some(root) if root.author_id.as_deref() == Some(&bookmark.author_id) => {
                posts.push(root)
            }
            _ => return Ok(bookmark),
        }
    }

    let query = format!(
        "conversation_id:{} from:{} to:{}",
        bookmark.conversation_id, bookmark.author_handle, bookmark.author_handle
    );
    let mut params: Vec<(&str, &str)> = POST_PARAMS.to_vec();
    params.push(("query", &query));
    params.push(("max_results", "100"));
    let found: RawList = match get_json(&tokens, "/tweets/search/all", &params).await {
        Ok(list) => list,
        Err(GetError::Refused(_)) => {
            match get_json(&tokens, "/tweets/search/recent", &params).await {
                Ok(list) => list,
                Err(GetError::Refused(_)) => return Ok(bookmark),
                Err(GetError::App(e)) => return Err(e),
            }
        }
        Err(GetError::App(e)) => return Err(e),
    };
    inc.add(found.includes);
    posts.extend(found.data);

    // The bookmarked post itself is the root when ids match; the root fetch or
    // the search covers it otherwise. Keep what we already have either way.
    let first = bookmark.posts.first().cloned();
    let posts = with_root(&bookmark, posts);
    let chain = thread_chain(&bookmark.conversation_id, &bookmark.author_id, &posts);
    if chain.len() <= 1 {
        return Ok(bookmark);
    }
    let mut expanded = bookmark.clone();
    expanded.posts = chain
        .into_iter()
        .map(|raw| match &first {
            Some(post) if post.id == raw.id => post.clone(),
            _ => to_post(raw, &inc),
        })
        .collect();
    Ok(expanded)
}

/// Search results never include the root itself; when the bookmark is the
/// root, stand it in so the chain has somewhere to start.
fn with_root(bookmark: &XBookmark, mut posts: Vec<RawPost>) -> Vec<RawPost> {
    if !posts.iter().any(|p| p.id == bookmark.conversation_id)
        && bookmark.id == bookmark.conversation_id
    {
        posts.push(RawPost {
            id: bookmark.id.clone(),
            author_id: Some(bookmark.author_id.clone()),
            ..RawPost::default()
        });
    }
    posts
}

/// Record bookmarks as saved for `root`, after their notes are written.
#[tauri::command]
pub fn x_mark_saved(app: tauri::AppHandle, root: String, ids: Vec<String>) -> Result<(), AppError> {
    add_saved(&saved_ids_path(&app)?, &root, &ids)
}

/// Download `url` into `<stem>-assets/<name>.<ext>` beside the note and return
/// that path relative to the note's folder. Pictures and MP4 video only.
#[tauri::command]
pub async fn x_save_media(
    url: String,
    markdown_file_path: String,
    name: String,
) -> Result<String, AppError> {
    let mut response = api_client()?
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Network(e.to_string()))?
        .error_for_status()
        .map_err(|e| AppError::Network(e.to_string()))?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let ext = media_extension(&content_type).ok_or_else(|| {
        AppError::User(format!("That isn't a picture or video ({content_type})."))
    })?;

    let md_path = PathBuf::from(&markdown_file_path);
    let dir = md_path
        .parent()
        .ok_or_else(|| AppError::Io("No parent directory".into()))?;
    let stem = md_path
        .file_stem()
        .ok_or_else(|| AppError::Io("No file stem".into()))?
        .to_string_lossy()
        .to_string();
    let assets = format!("{stem}-assets");
    std::fs::create_dir_all(dir.join(&assets))?;
    let file_name = format!("{name}.{ext}");
    let target = dir.join(&assets).join(&file_name);
    let partial = target.with_extension(format!("{ext}.part"));

    let mut file = std::fs::File::create(&partial)?;
    let mut written: u64 = 0;
    let result: Result<(), AppError> = async {
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| AppError::Network(e.to_string()))?
        {
            written += chunk.len() as u64;
            if written > MAX_MEDIA_BYTES {
                return Err(AppError::User("That video is too large to save.".into()));
            }
            file.write_all(&chunk)?;
        }
        file.flush()?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = result {
        let _ = std::fs::remove_file(&partial);
        return Err(e);
    }
    std::fs::rename(&partial, &target)?;
    Ok(format!("{assets}/{file_name}"))
}

fn media_extension(content_type: &str) -> Option<&'static str> {
    let mime = content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if mime == "video/mp4" {
        return Some("mp4");
    }
    super::covers::image_extension(&mime)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn post(json: serde_json::Value) -> RawPost {
        serde_json::from_value(json).unwrap()
    }

    #[test]
    fn clean_text_expands_links_and_drops_media_and_quote_links() {
        let raw = post(serde_json::json!({
            "id": "10",
            "text": "@a hi &amp; see https://t.co/x then https://t.co/m https://t.co/q",
            "display_text_range": [3, 65],
            "entities": { "urls": [
                { "url": "https://t.co/x", "expanded_url": "https://example.com/post" },
                { "url": "https://t.co/m", "expanded_url": "https://x.com/u/status/10/photo/1", "media_key": "3_1" },
                { "url": "https://t.co/q", "expanded_url": "https://x.com/b/status/99" }
            ]}
        }));
        assert_eq!(
            clean_text(&raw, Some("99")),
            "hi & see https://example.com/post then"
        );
    }

    #[test]
    fn clean_text_prefers_the_long_form_text() {
        let raw = post(serde_json::json!({
            "id": "1", "text": "short…", "note_post": { "text": "the whole long post" }
        }));
        assert_eq!(clean_text(&raw, None), "the whole long post");
    }

    #[test]
    fn old_field_names_still_parse() {
        let raw = post(serde_json::json!({
            "id": "1", "text": "x",
            "note_tweet": { "text": "long" },
            "referenced_tweets": [{ "type": "replied_to", "id": "0" }]
        }));
        assert_eq!(raw.note_post.unwrap().text, "long");
        assert_eq!(raw.referenced_posts[0].id, "0");
    }

    #[test]
    fn best_mp4_takes_the_highest_bit_rate() {
        let variants = vec![
            RawVariant {
                bit_rate: None,
                content_type: Some("application/x-mpegURL".into()),
                url: Some("m3u8".into()),
            },
            RawVariant {
                bit_rate: Some(632_000),
                content_type: Some("video/mp4".into()),
                url: Some("low".into()),
            },
            RawVariant {
                bit_rate: Some(2_176_000),
                content_type: Some("video/mp4".into()),
                url: Some("high".into()),
            },
        ];
        assert_eq!(best_mp4(&variants).as_deref(), Some("high"));
        let gif = vec![RawVariant {
            bit_rate: Some(0),
            content_type: Some("video/mp4".into()),
            url: Some("gif".into()),
        }];
        assert_eq!(best_mp4(&gif).as_deref(), Some("gif"));
    }

    #[test]
    fn media_kinds_map_to_files() {
        let photo = RawMedia {
            media_key: "1".into(),
            kind: "photo".into(),
            url: Some("https://pbs.twimg.com/media/a.jpg".into()),
            ..Default::default()
        };
        assert_eq!(
            to_media(&photo).unwrap().url,
            "https://pbs.twimg.com/media/a.jpg?name=large"
        );
        let gif = RawMedia {
            media_key: "2".into(),
            kind: "animated_gif".into(),
            preview_image_url: Some("poster.jpg".into()),
            variants: vec![RawVariant {
                bit_rate: Some(0),
                content_type: Some("video/mp4".into()),
                url: Some("g.mp4".into()),
            }],
            ..Default::default()
        };
        let media = to_media(&gif).unwrap();
        assert_eq!((media.kind.as_str(), media.url.as_str()), ("gif", "g.mp4"));
        assert_eq!(media.poster.as_deref(), Some("poster.jpg"));
    }

    fn reply(id: &str, author: &str, parent: Option<&str>) -> RawPost {
        RawPost {
            id: id.into(),
            author_id: Some(author.into()),
            referenced_posts: parent
                .map(|p| {
                    vec![RawRef {
                        kind: "replied_to".into(),
                        id: p.into(),
                    }]
                })
                .unwrap_or_default(),
            ..Default::default()
        }
    }

    #[test]
    fn thread_chain_follows_the_authors_own_replies() {
        let posts = vec![
            reply("30", "a", Some("20")),
            reply("10", "a", None),
            reply("20", "a", Some("10")),
            reply("25", "b", Some("20")), // someone else
            reply("26", "a", Some("25")), // the author answering them
            reply("40", "a", Some("30")),
        ];
        let ids: Vec<&str> = thread_chain("10", "a", &posts)
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(ids, vec!["10", "20", "30", "40"]);
    }

    #[test]
    fn thread_chain_orders_ids_numerically() {
        let posts = vec![reply("9", "a", None), reply("10", "a", Some("9"))];
        let ids: Vec<&str> = thread_chain("9", "a", &posts)
            .iter()
            .map(|p| p.id.as_str())
            .collect();
        assert_eq!(ids, vec!["9", "10"]);
    }

    #[test]
    fn a_reply_to_someone_else_may_have_a_thread_to_check() {
        let mut inc = Includes::default();
        inc.users.insert(
            "a".into(),
            RawUser {
                id: "a".into(),
                name: "A".into(),
                username: "aa".into(),
            },
        );
        let root = post(
            serde_json::json!({ "id": "5", "author_id": "a", "conversation_id": "5", "text": "hi" }),
        );
        let bookmark = to_bookmark(&root, &inc).unwrap();
        assert!(!bookmark.may_have_thread);
        assert_eq!(bookmark.url, "https://x.com/aa/status/5");
        let inner = post(
            serde_json::json!({ "id": "6", "author_id": "a", "conversation_id": "5", "text": "hi" }),
        );
        assert!(to_bookmark(&inner, &inc).unwrap().may_have_thread);
    }

    #[test]
    fn callback_checks_state_and_reads_the_code() {
        assert_eq!(
            parse_callback("GET /x/callback?state=s1&code=abc HTTP/1.1", "s1"),
            Ok("abc".into())
        );
        assert!(parse_callback("GET /x/callback?state=other&code=abc HTTP/1.1", "s1").is_err());
        assert_eq!(
            parse_callback(
                "GET /x/callback?error=access_denied&state=s1 HTTP/1.1",
                "s1"
            ),
            Err("You didn't allow Pensée to read your bookmarks.".into())
        );
        assert_eq!(
            parse_callback("GET /favicon.ico HTTP/1.1", "s1"),
            Err("not the callback".into())
        );
    }

    #[test]
    fn authorize_url_carries_pkce_and_scopes() {
        let (verifier, challenge) = pkce_pair();
        assert_eq!(verifier.len(), 64);
        assert_eq!(
            challenge,
            base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(Sha256::digest(verifier.as_bytes()))
        );
        let url = authorize_url("cid", "st", &challenge);
        assert!(
            url.starts_with("https://x.com/i/oauth2/authorize?response_type=code&client_id=cid")
        );
        assert!(url.contains("scope=tweet.read+users.read+bookmark.read+offline.access"));
        assert!(url.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A47863%2Fx%2Fcallback"));
        assert!(url.contains("code_challenge_method=S256"));
    }

    #[test]
    fn saved_ids_are_kept_per_vault() {
        let tmp = tempfile::TempDir::new().unwrap();
        let path = tmp.path().join("saved.json");
        add_saved(&path, "/v1", &["1".into(), "2".into()]).unwrap();
        add_saved(&path, "/v1", &["2".into(), "3".into()]).unwrap();
        add_saved(&path, "/v2", &["9".into()]).unwrap();
        let saved = read_saved(&path);
        assert_eq!(saved["/v1"], vec!["1", "2", "3"]);
        assert_eq!(saved["/v2"], vec!["9"]);
    }

    #[test]
    fn media_extension_allows_pictures_and_mp4() {
        assert_eq!(media_extension("video/mp4"), Some("mp4"));
        assert_eq!(media_extension("image/jpeg"), Some("jpg"));
        assert_eq!(media_extension("application/x-mpegURL"), None);
    }
}
