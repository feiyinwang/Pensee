//! `thumb://` serves a picture from disk scaled down to the box it is drawn
//! in, so a gallery of covers decodes small images instead of full-size ones
//! (SPECs/spaces-spec.md, "Covers"). The URL is `convertFileSrc(path,
//! "thumb")` plus `?w=<px>&h=<px>`, the box in device pixels. Scaled copies
//! are cached in the app's cache folder, keyed by the file's path, size and
//! modified time, so each cover is shrunk once. A picture of one flat colour
//! (an Apple Books export can come out all black) is refused with 422, so the
//! card draws its default cover instead. The path may also be an `.epub`:
//! then the picture is the cover inside the book, the one Apple Books shows,
//! read from the zip without unpacking the rest. Requests run on the blocking
//! pool, never on the main thread that also drives scrolling.

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageFormat};
use std::hash::{Hash, Hasher};
use std::io::{Cursor, Read, Seek};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "thumb";

/// The largest box a request may ask for: covers are drawn small.
const MAX_BOX: u32 = 2048;
const JPEG_QUALITY: u8 = 82;
/// How far apart, per channel, the pixels of a sample may be for a picture to
/// still count as one flat colour (JPEG noise on a solid fill stays under it).
const BLANK_SPREAD: u8 = 12;
/// The largest cover picture read out of an EPUB; anything bigger isn't one.
const MAX_EPUB_COVER: u64 = 32 * 1024 * 1024;

/// Encoded bytes, the cache file's extension and the MIME type.
type Encoded = (Vec<u8>, &'static str, &'static str);

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cache_dir = app
            .path()
            .app_cache_dir()
            .ok()
            .map(|d| d.join("cover-thumbs"));
        let scope = app.asset_protocol_scope();
        let response = match parse(&request) {
            Some((path, box_size)) if scope.is_allowed(&path) => {
                respond(&path, box_size, cache_dir.as_deref())
            }
            Some((path, _)) => {
                eprintln!(
                    "thumb: path not allowed by the asset scope: {}",
                    path.display()
                );
                status(StatusCode::FORBIDDEN)
            }
            None => status(StatusCode::BAD_REQUEST),
        };
        responder.respond(response);
    });
}

/// The file path and `(w, h)` box from `thumb://localhost/<encoded path>?w=&h=`.
fn parse(request: &Request<Vec<u8>>) -> Option<(PathBuf, (u32, u32))> {
    let uri = request.uri();
    let encoded = uri.path().strip_prefix('/')?;
    let path = PathBuf::from(
        percent_encoding::percent_decode_str(encoded)
            .decode_utf8()
            .ok()?
            .into_owned(),
    );
    if !path.is_absolute() {
        return None;
    }
    let (mut w, mut h) = (None, None);
    for pair in uri.query().unwrap_or("").split('&') {
        match pair.split_once('=') {
            Some(("w", v)) => w = v.parse::<u32>().ok(),
            Some(("h", v)) => h = v.parse::<u32>().ok(),
            _ => {}
        }
    }
    let valid = |v: u32| (1..=MAX_BOX).contains(&v);
    match (w, h) {
        (Some(w), Some(h)) if valid(w) && valid(h) => Some((path, (w, h))),
        _ => None,
    }
}

fn respond(path: &Path, box_size: (u32, u32), cache_dir: Option<&Path>) -> Response<Vec<u8>> {
    let meta = match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => meta,
        _ => return status(StatusCode::NOT_FOUND),
    };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    (path, meta.len(), modified, box_size).hash(&mut hasher);
    let key = format!("{:016x}", hasher.finish());

    if let Some(dir) = cache_dir {
        if dir.join(format!("{key}.blank")).is_file() {
            return status(StatusCode::UNPROCESSABLE_ENTITY);
        }
        for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
            if let Ok(bytes) = std::fs::read(dir.join(format!("{key}.{ext}"))) {
                return image_response(bytes, mime);
            }
        }
    }

    let (source, mime) = match read_source(path) {
        Ok(Some(found)) => found,
        Ok(None) => {
            eprintln!("thumb: {} has no cover inside", path.display());
            return status(StatusCode::NOT_FOUND);
        }
        Err(e) => {
            eprintln!("thumb: couldn't read {}: {e}", path.display());
            return status(StatusCode::NOT_FOUND);
        }
    };
    let img = match image::load_from_memory(&source) {
        Ok(img) => img,
        // A format the decoder doesn't read (GIF, AVIF…): the webview may.
        Err(e) => {
            eprintln!("thumb: couldn't decode {}: {e}", path.display());
            return image_response(source, mime);
        }
    };
    if is_blank(&img) {
        eprintln!("thumb: {} is one flat colour, not a cover", path.display());
        if let Some(dir) = cache_dir {
            if let Err(e) = write_cache(dir, &format!("{key}.blank"), &[]) {
                eprintln!("thumb: couldn't cache {}: {e}", path.display());
            }
        }
        return status(StatusCode::UNPROCESSABLE_ENTITY);
    }
    match scale(&img, box_size) {
        Ok(Some((bytes, ext, mime))) => {
            if let Some(dir) = cache_dir {
                if let Err(e) = write_cache(dir, &format!("{key}.{ext}"), &bytes) {
                    eprintln!("thumb: couldn't cache {}: {e}", path.display());
                }
            }
            image_response(bytes, mime)
        }
        // Already no bigger than the box: the original is the thumbnail.
        Ok(None) => image_response(source, mime),
        Err(e) => {
            eprintln!("thumb: couldn't scale {}: {e}", path.display());
            image_response(source, mime)
        }
    }
}

/// The picture's bytes and MIME type: the file itself, or for an `.epub` the
/// cover inside it (`None` when the book has none).
fn read_source(path: &Path) -> std::io::Result<Option<(Vec<u8>, &'static str)>> {
    let is_epub = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("epub"));
    if !is_epub {
        return Ok(Some((std::fs::read(path)?, original_mime(path))));
    }
    let cover = epub_cover(std::fs::File::open(path)?)?;
    Ok(cover.map(|(bytes, name)| (bytes, original_mime(Path::new(&name)))))
}

/// The cover picture inside an EPUB and its name in the zip. The package file
/// (named by `META-INF/container.xml`) marks it: EPUB 3 with
/// `properties="cover-image"`, EPUB 2 with `<meta name="cover" content="id">`;
/// else the first picture in the manifest, which is the cover in most books.
fn epub_cover<R: Read + Seek>(reader: R) -> std::io::Result<Option<(Vec<u8>, String)>> {
    let mut zip = zip::ZipArchive::new(reader).map_err(std::io::Error::other)?;
    let Some(container) = zip_entry(&mut zip, "META-INF/container.xml")? else {
        return Ok(None);
    };
    let container = parse_xml(&container)?;
    let Some(opf_path) = container
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
    else {
        return Ok(None);
    };
    let Some(opf) = zip_entry(&mut zip, opf_path)? else {
        return Ok(None);
    };
    let opf = parse_xml(&opf)?;
    let items: Vec<_> = opf
        .descendants()
        .filter(|n| n.has_tag_name("item"))
        .collect();
    let cover_id = opf
        .descendants()
        .find(|n| n.has_tag_name("meta") && n.attribute("name") == Some("cover"))
        .and_then(|n| n.attribute("content"));
    let item = items
        .iter()
        .find(|i| {
            i.attribute("properties")
                .is_some_and(|p| p.split_whitespace().any(|w| w == "cover-image"))
        })
        .or_else(|| {
            items
                .iter()
                .find(|i| cover_id.is_some() && i.attribute("id") == cover_id)
        })
        .or_else(|| {
            items.iter().find(|i| {
                i.attribute("media-type")
                    .is_some_and(|t| t.starts_with("image/"))
            })
        });
    let Some(href) = item.and_then(|i| i.attribute("href")) else {
        return Ok(None);
    };
    let base = opf_path.rfind('/').map_or("", |i| &opf_path[..=i]);
    let name = resolve_href(base, href);
    Ok(zip_entry(&mut zip, &name)?.map(|bytes| (bytes, name)))
}

/// An entry's bytes, `None` when the zip has no such entry or it is too big
/// to be a cover or a package file.
fn zip_entry<R: Read + Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> std::io::Result<Option<Vec<u8>>> {
    let mut entry = match zip.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(e) => return Err(std::io::Error::other(e)),
    };
    if entry.size() > MAX_EPUB_COVER {
        return Ok(None);
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut bytes)?;
    Ok(Some(bytes))
}

fn parse_xml(bytes: &[u8]) -> std::io::Result<roxmltree::Document<'_>> {
    let text = std::str::from_utf8(bytes).map_err(std::io::Error::other)?;
    let options = roxmltree::ParsingOptions {
        allow_dtd: true,
        ..Default::default()
    };
    roxmltree::Document::parse_with_options(text.trim_start_matches('\u{feff}'), options)
        .map_err(std::io::Error::other)
}

/// A manifest `href` (percent-encoded, relative to the package file's folder)
/// as a name in the zip.
fn resolve_href(base: &str, href: &str) -> String {
    let href = percent_encoding::percent_decode_str(href).decode_utf8_lossy();
    let mut parts: Vec<&str> = Vec::new();
    for part in base.split('/').chain(href.split('/')) {
        match part {
            ".." => {
                parts.pop();
            }
            "" | "." => {}
            part => parts.push(part),
        }
    }
    parts.join("/")
}

/// Whether the picture is one flat colour throughout, judged on a small sample.
fn is_blank(img: &DynamicImage) -> bool {
    let sample = img.thumbnail(32, 32).to_rgba8();
    let mut pixels = sample.pixels();
    let Some(first) = pixels.next() else {
        return true;
    };
    let (mut lo, mut hi) = (first.0, first.0);
    for p in pixels {
        for c in 0..4 {
            lo[c] = lo[c].min(p.0[c]);
            hi[c] = hi[c].max(p.0[c]);
        }
    }
    (0..4).all(|c| hi[c] - lo[c] <= BLANK_SPREAD)
}

/// The picture scaled to cover `box_size`, encoded as JPEG (PNG when it has
/// transparency), or `None` when it is no larger than the box already.
fn scale(
    img: &DynamicImage,
    (box_w, box_h): (u32, u32),
) -> Result<Option<Encoded>, image::ImageError> {
    let (w, h) = (img.width(), img.height());
    // Cover fit: the image fills the box, as `object-fit: cover` draws it.
    let factor = (box_w as f64 / w as f64).max(box_h as f64 / h as f64);
    if factor >= 1.0 {
        return Ok(None);
    }
    let (tw, th) = (
        ((w as f64 * factor).round() as u32).max(1),
        ((h as f64 * factor).round() as u32).max(1),
    );
    let small = img.resize_exact(tw, th, FilterType::Triangle);
    let mut out = Vec::new();
    if small.color().has_alpha() {
        small.write_to(&mut Cursor::new(&mut out), ImageFormat::Png)?;
        Ok(Some((out, "png", "image/png")))
    } else {
        let rgb = DynamicImage::ImageRgb8(small.to_rgb8());
        rgb.write_with_encoder(JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY))?;
        Ok(Some((out, "jpg", "image/jpeg")))
    }
}

/// Write through a temporary name so a concurrent request never reads half a file.
fn write_cache(dir: &Path, name: &str, bytes: &[u8]) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!("{name}.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dir.join(name))
}

fn original_mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    match ext.as_deref() {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("avif") => "image/avif",
        Some("svg") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn image_response(bytes: Vec<u8>, mime: &str) -> Response<Vec<u8>> {
    Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .body(bytes)
        .unwrap_or_else(|_| status(StatusCode::INTERNAL_SERVER_ERROR))
}

fn status(code: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = code;
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage, Rgba, RgbaImage};

    /// A picture that isn't one flat colour: a gradient across its width.
    fn gradient(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(RgbImage::from_fn(w, h, |x, _| {
            Rgb([(x * 255 / w) as u8, 40, 90])
        }))
    }

    fn encode(img: DynamicImage, format: ImageFormat) -> Vec<u8> {
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), format).unwrap();
        out
    }

    #[test]
    fn scales_to_cover_the_box() {
        let src = DynamicImage::ImageRgb8(RgbImage::from_pixel(700, 1024, Rgb([200, 10, 10])));
        let (bytes, ext, _) = scale(&src, (320, 480)).unwrap().unwrap();
        assert_eq!(ext, "jpg");
        let out = image::load_from_memory(&bytes).unwrap();
        // 480/1024 > 320/700, so the height fills the box.
        assert_eq!((out.width(), out.height()), (328, 480));
    }

    #[test]
    fn a_wide_picture_fills_a_tall_box() {
        let src = DynamicImage::ImageRgb8(RgbImage::from_pixel(1280, 720, Rgb([0, 0, 0])));
        let (bytes, _, _) = scale(&src, (320, 480)).unwrap().unwrap();
        let out = image::load_from_memory(&bytes).unwrap();
        assert_eq!((out.width(), out.height()), (853, 480));
    }

    #[test]
    fn keeps_a_picture_already_inside_the_box() {
        let src = DynamicImage::ImageRgb8(RgbImage::from_pixel(200, 300, Rgb([0, 0, 0])));
        assert!(scale(&src, (320, 480)).unwrap().is_none());
    }

    #[test]
    fn transparency_stays_png() {
        let src = DynamicImage::ImageRgba8(RgbaImage::from_pixel(1000, 1000, Rgba([0, 0, 0, 0])));
        let (_, ext, mime) = scale(&src, (320, 320)).unwrap().unwrap();
        assert_eq!((ext, mime), ("png", "image/png"));
    }

    #[test]
    fn responds_from_the_cache_the_second_time() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("cover.png");
        std::fs::write(&file, encode(gradient(900, 900), ImageFormat::Png)).unwrap();
        let cache = dir.path().join("cache");
        let first = respond(&file, (300, 300), Some(&cache));
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 1);
        let second = respond(&file, (300, 300), Some(&cache));
        assert_eq!(first.body(), second.body());
    }

    #[test]
    fn refuses_a_cover_of_one_flat_colour() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        for (name, fill) in [("black.jpg", [0, 0, 0]), ("grey.jpg", [128, 128, 128])] {
            let file = dir.path().join(name);
            let flat = DynamicImage::ImageRgb8(RgbImage::from_pixel(600, 900, Rgb(fill)));
            std::fs::write(&file, encode(flat, ImageFormat::Jpeg)).unwrap();
            let first = respond(&file, (300, 450), Some(&cache));
            assert_eq!(first.status(), StatusCode::UNPROCESSABLE_ENTITY, "{name}");
            // Remembered, so the next request doesn't decode it again.
            let second = respond(&file, (300, 450), Some(&cache));
            assert_eq!(second.status(), StatusCode::UNPROCESSABLE_ENTITY, "{name}");
        }
    }

    #[test]
    fn a_cover_with_a_picture_is_not_blank() {
        assert!(!is_blank(&gradient(600, 900)));
        // A dark cover with a little light text on it still shows.
        let mut dark = RgbImage::from_pixel(600, 900, Rgb([8, 8, 8]));
        for x in 100..500 {
            for y in 400..440 {
                dark.put_pixel(x, y, Rgb([230, 230, 230]));
            }
        }
        assert!(!is_blank(&DynamicImage::ImageRgb8(dark)));
    }

    const CONTAINER: &str = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#;

    /// An EPUB whose package file has `manifest` and `metadata`, holding
    /// `files` (name, bytes). Pictures are deflated, as real books store them.
    fn epub(metadata: &str, manifest: &str, files: &[(&str, &[u8])]) -> Vec<u8> {
        use zip::write::SimpleFileOptions;
        let opf = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">{metadata}</metadata>
  <manifest>{manifest}</manifest>
</package>"#
        );
        let mut out = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        let stored =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("mimetype", stored).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", deflated).unwrap();
        zip.write_all(CONTAINER.as_bytes()).unwrap();
        zip.start_file("OEBPS/content.opf", deflated).unwrap();
        zip.write_all(opf.as_bytes()).unwrap();
        for (name, bytes) in files {
            zip.start_file(*name, deflated).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
        out.into_inner()
    }

    fn cover_name(book: Vec<u8>) -> Option<String> {
        epub_cover(Cursor::new(book)).unwrap().map(|(_, name)| name)
    }

    use std::io::Write;

    #[test]
    fn finds_an_epub3_cover_image() {
        let book = epub(
            "",
            r#"<item id="logo" href="images/logo.png" media-type="image/png"/>
               <item id="c" href="images/cover%20art.jpg" media-type="image/jpeg" properties="cover-image"/>"#,
            &[
                ("OEBPS/images/logo.png", b"logo"),
                ("OEBPS/images/cover art.jpg", b"cover"),
            ],
        );
        let (bytes, name) = epub_cover(Cursor::new(book)).unwrap().unwrap();
        assert_eq!(name, "OEBPS/images/cover art.jpg");
        assert_eq!(bytes, b"cover");
    }

    #[test]
    fn finds_an_epub2_cover_meta() {
        let book = epub(
            r#"<meta name="cover" content="cover-pic"/>"#,
            r#"<item id="logo" href="logo.png" media-type="image/png"/>
               <item id="cover-pic" href="../Images/front.jpeg" media-type="image/jpeg"/>"#,
            &[("OEBPS/logo.png", b"logo"), ("Images/front.jpeg", b"front")],
        );
        assert_eq!(cover_name(book).as_deref(), Some("Images/front.jpeg"));
    }

    #[test]
    fn falls_back_to_the_first_picture() {
        let book = epub(
            "",
            r#"<item id="text" href="ch1.xhtml" media-type="application/xhtml+xml"/>
               <item id="p1" href="first.png" media-type="image/png"/>
               <item id="p2" href="second.png" media-type="image/png"/>"#,
            &[("OEBPS/first.png", b"1"), ("OEBPS/second.png", b"2")],
        );
        assert_eq!(cover_name(book).as_deref(), Some("OEBPS/first.png"));
    }

    #[test]
    fn a_book_without_pictures_has_no_cover() {
        let book = epub(
            "",
            r#"<item id="text" href="ch1.xhtml" media-type="application/xhtml+xml"/>"#,
            &[],
        );
        assert_eq!(cover_name(book), None);
        // A cover the manifest names but the zip lacks.
        let missing = epub(
            "",
            r#"<item id="c" href="gone.jpg" media-type="image/jpeg" properties="cover-image"/>"#,
            &[],
        );
        assert_eq!(cover_name(missing), None);
    }

    #[test]
    fn a_file_that_is_not_a_zip_is_an_error() {
        assert!(epub_cover(Cursor::new(b"not a zip".to_vec())).is_err());
    }

    #[test]
    fn serves_the_cover_inside_an_epub() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let jpeg = encode(gradient(700, 1050), ImageFormat::Jpeg);
        let manifest =
            r#"<item id="c" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/>"#;
        let file = dir.path().join("Skip the line.EPUB");
        std::fs::write(&file, epub("", manifest, &[("OEBPS/cover.jpg", &jpeg)])).unwrap();
        let response = respond(&file, (360, 540), Some(&cache));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE].to_str().unwrap(),
            "image/jpeg"
        );
        let out = image::load_from_memory(response.body()).unwrap();
        assert_eq!((out.width(), out.height()), (360, 540));

        // A book whose own cover is one flat colour is refused like any other.
        let black = encode(
            DynamicImage::ImageRgb8(RgbImage::from_pixel(600, 900, Rgb([0, 0, 0]))),
            ImageFormat::Jpeg,
        );
        let flat = dir.path().join("flat.epub");
        std::fs::write(&flat, epub("", manifest, &[("OEBPS/cover.jpg", &black)])).unwrap();
        let refused = respond(&flat, (360, 540), Some(&cache));
        assert_eq!(refused.status(), StatusCode::UNPROCESSABLE_ENTITY);

        // No cover inside: not found, so the card falls back to `Cover:`.
        let bare = dir.path().join("bare.epub");
        std::fs::write(&bare, epub("", "", &[])).unwrap();
        assert_eq!(
            respond(&bare, (360, 540), Some(&cache)).status(),
            StatusCode::NOT_FOUND
        );
    }

    // A Mac path; on Windows the URL holds `C:/…` (the next test).
    #[cfg(not(windows))]
    #[test]
    fn parses_the_path_and_box() {
        let request = Request::builder()
            .uri("thumb://localhost/%2FUsers%2Fme%2FMy%20vault%2Fcover.jpg?w=320&h=480")
            .body(Vec::new())
            .unwrap();
        let (path, size) = parse(&request).unwrap();
        assert_eq!(path, PathBuf::from("/Users/me/My vault/cover.jpg"));
        assert_eq!(size, (320, 480));
    }

    #[cfg(windows)]
    #[test]
    fn parses_a_windows_path_and_box() {
        let request = Request::builder()
            .uri("http://thumb.localhost/C%3A%2FUsers%2Fme%2FMy%20vault%2Fcover.jpg?w=320&h=480")
            .body(Vec::new())
            .unwrap();
        let (path, size) = parse(&request).unwrap();
        assert_eq!(path, PathBuf::from(r"C:\Users\me\My vault\cover.jpg"));
        assert_eq!(size, (320, 480));
    }

    #[test]
    fn refuses_a_missing_or_huge_box() {
        for uri in [
            "thumb://localhost/%2Fa.jpg",
            "thumb://localhost/%2Fa.jpg?w=0&h=10",
            "thumb://localhost/%2Fa.jpg?w=99999&h=10",
            "thumb://localhost/relative.jpg?w=10&h=10",
        ] {
            let request = Request::builder().uri(uri).body(Vec::new()).unwrap();
            assert!(parse(&request).is_none(), "{uri}");
        }
    }
}
