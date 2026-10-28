//! Small raw-AppKit helpers shared by Pensée's native macOS integrations.

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use std::ffi::CStr;
use std::os::raw::c_char;
use std::ptr;

const NS_UTF8_STRING_ENCODING: usize = 4;

/// Tauri owns the application delegate for the lifetime of the process. Native
/// integrations add narrowly named selectors to that stable object rather than
/// replacing it.
pub(crate) unsafe fn app_delegate() -> Option<*mut AnyObject> {
    let app: *mut AnyObject = unsafe { msg_send![class!(NSApplication), sharedApplication] };
    if app.is_null() {
        return None;
    }
    let delegate: *mut AnyObject = unsafe { msg_send![app, delegate] };
    (!delegate.is_null()).then_some(delegate)
}

pub(crate) unsafe fn ns_string(value: &str) -> *mut AnyObject {
    let string: *mut AnyObject = unsafe { msg_send![class!(NSString), alloc] };
    if string.is_null() {
        return ptr::null_mut();
    }
    let string: *mut AnyObject = unsafe {
        msg_send![
            string,
            initWithBytes: value.as_ptr(),
            length: value.len(),
            encoding: NS_UTF8_STRING_ENCODING
        ]
    };
    if string.is_null() {
        return ptr::null_mut();
    }
    let _: *mut AnyObject = unsafe { msg_send![string, autorelease] };
    string
}

pub(crate) unsafe fn ns_string_to_string(value: *mut AnyObject) -> Option<String> {
    if value.is_null() {
        return None;
    }
    let bytes: *const c_char = unsafe { msg_send![value, UTF8String] };
    if bytes.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(bytes) }
        .to_str()
        .ok()
        .map(str::to_owned)
}

/// Let a WKWebView render at the display's refresh rate instead of WebKit's
/// default cap near 60fps (`PreferPageRenderingUpdatesNear60FPSEnabled`, the
/// same switch as Safari's "Prefer Page Rendering Updates near 60fps" flag).
/// Scrolling is paced by page rendering, so on a 120Hz ProMotion display the
/// capped view visibly trails a trackpad swipe next to native apps.
///
/// Uses WebKit's private feature API (`+[WKPreferences _features]`,
/// `-_setEnabled:forFeature:`). If a WebKit release drops either, this logs
/// and leaves the default cap in place.
pub(crate) unsafe fn render_at_display_refresh_rate(webview: *mut AnyObject) {
    const FEATURE_KEY: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";
    let fail = |reason: &str| eprintln!("webview: cannot lift the 60fps rendering cap: {reason}");

    if webview.is_null() {
        return fail("no WKWebView");
    }
    let preferences_class = class!(WKPreferences);
    let has_features: bool =
        unsafe { msg_send![preferences_class, respondsToSelector: objc2::sel!(_features)] };
    if !has_features {
        return fail("+[WKPreferences _features] is missing");
    }
    let configuration: *mut AnyObject = unsafe { msg_send![webview, configuration] };
    let preferences: *mut AnyObject = if configuration.is_null() {
        ptr::null_mut()
    } else {
        unsafe { msg_send![configuration, preferences] }
    };
    if preferences.is_null() {
        return fail("no WKPreferences");
    }
    let can_set: bool =
        unsafe { msg_send![preferences, respondsToSelector: objc2::sel!(_setEnabled:forFeature:)] };
    if !can_set {
        return fail("-[WKPreferences _setEnabled:forFeature:] is missing");
    }

    let features: *mut AnyObject = unsafe { msg_send![preferences_class, _features] };
    let count: usize = if features.is_null() {
        0
    } else {
        unsafe { msg_send![features, count] }
    };
    for index in 0..count {
        let feature: *mut AnyObject = unsafe { msg_send![features, objectAtIndex: index] };
        let key: *mut AnyObject = unsafe { msg_send![feature, key] };
        if unsafe { ns_string_to_string(key) }.as_deref() == Some(FEATURE_KEY) {
            let _: () = unsafe { msg_send![preferences, _setEnabled: false, forFeature: feature] };
            return;
        }
    }
    fail("feature not found");
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

/// A rectangle in the web view's own points: top-left origin (a WKWebView is
/// flipped), page zoom already applied.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

impl CGRect {
    pub(crate) fn new(x: f64, y: f64, width: f64, height: f64) -> Self {
        Self {
            origin: CGPoint { x, y },
            size: CGSize { width, height },
        }
    }
}

unsafe impl objc2::Encode for CGPoint {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

unsafe impl objc2::Encode for CGSize {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]);
}

unsafe impl objc2::Encode for CGRect {
    const ENCODING: objc2::Encoding =
        objc2::Encoding::Struct("CGRect", &[CGPoint::ENCODING, CGSize::ENCODING]);
}

const NS_BITMAP_IMAGE_FILE_TYPE_PNG: usize = 4;

/// A PNG of `rect` in `webview`, as WebKit draws it: framed pages and a
/// playing video included, other windows over it not. Calls `done` once, on
/// the main thread. Must be called on the main thread.
pub(crate) unsafe fn snapshot_png(
    webview: *mut AnyObject,
    rect: CGRect,
    done: impl FnOnce(Result<Vec<u8>, String>) + 'static,
) {
    if webview.is_null() {
        return done(Err("no WKWebView".into()));
    }
    let configuration: *mut AnyObject = unsafe { msg_send![class!(WKSnapshotConfiguration), new] };
    if configuration.is_null() {
        return done(Err("no WKSnapshotConfiguration".into()));
    }
    let _: () = unsafe { msg_send![configuration, setRect: rect] };
    let done = std::cell::Cell::new(Some(done));
    let handler = block2::RcBlock::new(move |image: *mut AnyObject, error: *mut AnyObject| {
        let Some(done) = done.take() else { return };
        done(unsafe { png_of(image, error) });
    });
    let _: () = unsafe {
        msg_send![webview, takeSnapshotWithConfiguration: configuration, completionHandler: &*handler]
    };
    let _: () = unsafe { msg_send![configuration, release] };
}

unsafe fn png_of(image: *mut AnyObject, error: *mut AnyObject) -> Result<Vec<u8>, String> {
    if image.is_null() {
        let description: *mut AnyObject = if error.is_null() {
            ptr::null_mut()
        } else {
            unsafe { msg_send![error, localizedDescription] }
        };
        return Err(unsafe { ns_string_to_string(description) }
            .unwrap_or_else(|| "WebKit returned no image".into()));
    }
    let tiff: *mut AnyObject = unsafe { msg_send![image, TIFFRepresentation] };
    if tiff.is_null() {
        return Err("the snapshot has no bitmap".into());
    }
    let bitmap: *mut AnyObject =
        unsafe { msg_send![class!(NSBitmapImageRep), imageRepWithData: tiff] };
    if bitmap.is_null() {
        return Err("the snapshot's bitmap can't be read".into());
    }
    let properties: *mut AnyObject = unsafe { msg_send![class!(NSDictionary), dictionary] };
    let png: *mut AnyObject = unsafe {
        msg_send![
            bitmap,
            representationUsingType: NS_BITMAP_IMAGE_FILE_TYPE_PNG,
            properties: properties
        ]
    };
    if png.is_null() {
        return Err("the snapshot can't be encoded as PNG".into());
    }
    let length: usize = unsafe { msg_send![png, length] };
    let bytes: *const std::ffi::c_void = unsafe { msg_send![png, bytes] };
    if bytes.is_null() || length == 0 {
        return Err("the snapshot's PNG is empty".into());
    }
    Ok(unsafe { std::slice::from_raw_parts(bytes.cast::<u8>(), length) }.to_vec())
}
