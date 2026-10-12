//! `thumb://` serves a picture from disk scaled down to the box it is drawn
//! in, so a gallery of covers decodes small images instead of full-size ones
//! (SPECs/spaces-spec.md, "Covers"). The URL is `convertFileSrc(path,
//! "thumb")` plus `?w=<px>&h=<px>`, the box in device pixels. Scaled copies
//! are cached in the app's cache folder, keyed by the file's path, size and
//! modified time, so each cover is shrunk once. A picture of one flat colour
//! (an Apple Books export can come out all black) is refused with 422, so the
//! card draws its default cover instead. Requests run on the blocking pool,
//! never on the main thread that also drives scrolling.

use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, ImageFormat};
use std::hash::{Hash, Hasher};
use std::io::Cursor;
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

    let source = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return status(StatusCode::NOT_FOUND),
    };
    let img = match image::load_from_memory(&source) {
        Ok(img) => img,
        // A format the decoder doesn't read (GIF, AVIF…): the webview may.
        Err(e) => {
            eprintln!("thumb: couldn't decode {}: {e}", path.display());
            return image_response(source, original_mime(path));
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
        Ok(None) => image_response(source, original_mime(path)),
        Err(e) => {
            eprintln!("thumb: couldn't scale {}: {e}", path.display());
            image_response(source, original_mime(path))
        }
    }
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
