//! Small raw-AppKit helpers shared by Writer's native macOS integrations.

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
