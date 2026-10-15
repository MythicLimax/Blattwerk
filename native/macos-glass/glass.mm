// Apples Liquid Glass (NSGlassEffectView, macOS 26+) hinter durchsichtigen Bereichen des Fensters (ADR 0023).
// Node-API-Modul ohne Abhängigkeiten; wird im Hauptprozess (läuft im Haupt-Thread von AppKit) geladen.
//
//   attach(handle)            Fenster durchsichtig machen (Inhalt der Web-Ansicht bleibt deckend, wo er Farbe hat)
//   setRegions(handle, list)  Glasflächen setzen: { x, y, width, height, radius, tint: [r, g, b, a], style, anchor }
//   detach(handle)            alle Glasflächen entfernen, Fenster wieder deckend
//   supported()               true ab macOS 26
//
// Die Glasflächen liegen als unterste Unteransichten in der Inhaltsansicht des Fensters, also unter der Web-Ansicht.
// Sie zeigen, was hinter dem Fenster liegt (Schreibtisch, andere Fenster); die App zeichnet ihre Bedienelemente darüber.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <node_api.h>

static NSMapTable<NSWindow *, NSMutableArray<NSView *> *> *regionsByWindow;

static bool glassAvailable() {
  if (@available(macOS 26.0, *)) return NSClassFromString(@"NSGlassEffectView") != nil;
  return false;
}

static NSView *viewFromHandle(napi_env env, napi_value value) {
  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != napi_ok || length < sizeof(void *)) return nil;
  NSView *view = (__bridge NSView *)(*reinterpret_cast<void **>(data));
  return [view isKindOfClass:[NSView class]] ? view : nil;
}

static double numberProperty(napi_env env, napi_value object, const char *name, double fallback) {
  napi_value value;
  double result = fallback;
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok || !has) return fallback;
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return fallback;
  if (napi_get_value_double(env, value, &result) != napi_ok || !isfinite(result)) return fallback;
  return result;
}

static NSString *stringProperty(napi_env env, napi_value object, const char *name) {
  napi_value value;
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok || !has) return @"";
  if (napi_get_named_property(env, object, name, &value) != napi_ok) return @"";
  char buffer[64] = {0};
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, buffer, sizeof(buffer), &length) != napi_ok) return @"";
  return [NSString stringWithUTF8String:buffer];
}

static NSColor *tintProperty(napi_env env, napi_value object) {
  napi_value value;
  bool has = false, isArray = false;
  if (napi_has_named_property(env, object, "tint", &has) != napi_ok || !has) return nil;
  if (napi_get_named_property(env, object, "tint", &value) != napi_ok) return nil;
  if (napi_is_array(env, value, &isArray) != napi_ok || !isArray) return nil;
  double channels[4] = {0, 0, 0, 0};
  for (uint32_t i = 0; i < 4; i++) {
    napi_value item;
    if (napi_get_element(env, value, i, &item) != napi_ok) return nil;
    napi_get_value_double(env, item, &channels[i]);
  }
  return [NSColor colorWithSRGBRed:channels[0] / 255.0 green:channels[1] / 255.0 blue:channels[2] / 255.0 alpha:fmin(1, fmax(0, channels[3]))];
}

// Größenänderung mit dem Fenster: oben angeheftet und breit („band“), links/rechts mit voller Höhe, ganz („fill“)
static NSAutoresizingMaskOptions maskFor(NSString *anchor, BOOL flipped) {
  NSAutoresizingMaskOptions keepTop = flipped ? NSViewMaxYMargin : NSViewMinYMargin;
  if ([anchor isEqualToString:@"band"]) return NSViewWidthSizable | keepTop;
  if ([anchor isEqualToString:@"left"]) return NSViewHeightSizable | NSViewMaxXMargin;
  if ([anchor isEqualToString:@"right"]) return NSViewHeightSizable | NSViewMinXMargin;
  if ([anchor isEqualToString:@"fill"]) return NSViewWidthSizable | NSViewHeightSizable;
  return NSViewMaxXMargin | keepTop;
}

static napi_value makeBool(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

static napi_value Supported(napi_env env, napi_callback_info) {
  return makeBool(env, glassAvailable());
}

static napi_value Attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1 || !glassAvailable()) return makeBool(env, false);
  NSView *view = viewFromHandle(env, argv[0]);
  NSWindow *window = view.window;
  if (!window) return makeBool(env, false);
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.hasShadow = YES;
  [window invalidateShadow];
  if (!regionsByWindow) regionsByWindow = [NSMapTable weakToStrongObjectsMapTable];
  if (![regionsByWindow objectForKey:window]) [regionsByWindow setObject:[NSMutableArray array] forKey:window];
  return makeBool(env, true);
}

static napi_value SetRegions(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2 || !glassAvailable()) return makeBool(env, false);
  NSView *handleView = viewFromHandle(env, argv[0]);
  NSWindow *window = handleView.window;
  NSMutableArray<NSView *> *views = window ? [regionsByWindow objectForKey:window] : nil;
  bool isArray = false;
  if (!views || napi_is_array(env, argv[1], &isArray) != napi_ok || !isArray) return makeBool(env, false);
  uint32_t count = 0;
  napi_get_array_length(env, argv[1], &count);
  count = count > 32 ? 32 : count;
  NSView *content = window.contentView;
  BOOL flipped = content.isFlipped;
  CGFloat contentHeight = NSHeight(content.bounds);

  if (@available(macOS 26.0, *)) {
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    for (uint32_t i = 0; i < count; i++) {
      napi_value region;
      if (napi_get_element(env, argv[1], i, &region) != napi_ok) continue;
      double x = numberProperty(env, region, "x", 0), y = numberProperty(env, region, "y", 0);
      double width = fmax(0, numberProperty(env, region, "width", 0)), height = fmax(0, numberProperty(env, region, "height", 0));
      NSGlassEffectView *glass;
      if (i < views.count) {
        glass = (NSGlassEffectView *)views[i];
      } else {
        glass = [[NSGlassEffectView alloc] initWithFrame:NSZeroRect];
        // Ganz unten einfügen: unter der Web-Ansicht und allen anderen Unteransichten
        [content addSubview:glass positioned:NSWindowBelow relativeTo:nil];
        [views addObject:glass];
      }
      glass.frame = NSMakeRect(x, flipped ? y : contentHeight - y - height, width, height);
      glass.cornerRadius = fmax(0, numberProperty(env, region, "radius", 0));
      glass.style = [stringProperty(env, region, "style") isEqualToString:@"clear"] ? NSGlassEffectViewStyleClear : NSGlassEffectViewStyleRegular;
      glass.tintColor = tintProperty(env, region);
      glass.autoresizingMask = maskFor(stringProperty(env, region, "anchor"), flipped);
      glass.hidden = width < 1 || height < 1;
    }
    while (views.count > count) {
      [views.lastObject removeFromSuperview];
      [views removeLastObject];
    }
    [CATransaction commit];
  }
  return makeBool(env, true);
}

static napi_value Detach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSWindow *window = argc > 0 ? viewFromHandle(env, argv[0]).window : nil;
  NSMutableArray<NSView *> *views = window ? [regionsByWindow objectForKey:window] : nil;
  for (NSView *view in views) [view removeFromSuperview];
  if (window) {
    [regionsByWindow removeObjectForKey:window];
    window.opaque = YES;
  }
  return makeBool(env, window != nil);
}

// Für Tests: Anzahl und Rahmen der Glasflächen (Fensterkoordinaten, oben links)
static napi_value Describe(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  napi_value result;
  napi_create_array(env, &result);
  NSWindow *window = argc > 0 ? viewFromHandle(env, argv[0]).window : nil;
  NSMutableArray<NSView *> *views = window ? [regionsByWindow objectForKey:window] : nil;
  NSView *content = window.contentView;
  uint32_t index = 0;
  for (NSView *view in views) {
    NSRect frame = view.frame;
    double top = content.isFlipped ? NSMinY(frame) : NSHeight(content.bounds) - NSMaxY(frame);
    napi_value item, number;
    napi_create_object(env, &item);
    const double values[4] = {NSMinX(frame), top, NSWidth(frame), NSHeight(frame)};
    const char *names[4] = {"x", "y", "width", "height"};
    for (int i = 0; i < 4; i++) {
      napi_create_double(env, values[i], &number);
      napi_set_named_property(env, item, names[i], number);
    }
    napi_value opaque;
    napi_get_boolean(env, window.isOpaque, &opaque);
    napi_set_named_property(env, item, "windowOpaque", opaque);
    napi_set_element(env, result, index++, item);
  }
  return result;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
      {"supported", nullptr, Supported, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"attach", nullptr, Attach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setRegions", nullptr, SetRegions, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"detach", nullptr, Detach, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"describe", nullptr, Describe, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
