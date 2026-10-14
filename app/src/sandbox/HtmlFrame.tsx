// Native (Android / iOS) frame: one react-native-webview per HtmlBlock, locked down.
import { useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useT } from '../i18n';
import type { HtmlFrameProps } from './frameTypes';
import { injectionFor, isAllowedNavigation } from './messages';
import { LOCKED_WEBVIEW_PROPS } from './webviewConfig';

export function HtmlFrame({ ref, shellHtml, scrollEnabled, onMessage, onLoaded, onCrash, onTouch, accessibilityLabel }: HtmlFrameProps) {
  const tr = useT();
  const webview = useRef<WebView>(null);
  useImperativeHandle(ref, () => ({ post: (msg) => webview.current?.injectJavaScript(injectionFor(msg)) }), []);
  const source = useMemo(() => ({ html: shellHtml }), [shellHtml]);

  return (
    <View
      style={StyleSheet.absoluteFill}
      // raw touches (not the responder system: the WebView keeps handling them); the gate decides what is a tap
      onTouchStart={onTouch ? (e) => onTouch('start', e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
      onTouchMove={onTouch ? (e) => onTouch('move', e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
      onTouchEnd={onTouch ? (e) => onTouch('end', e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
      onTouchCancel={onTouch ? (e) => onTouch('cancel', e.nativeEvent.pageX, e.nativeEvent.pageY) : undefined}
    >
      <WebView
        ref={webview}
        source={source}
        style={styles.webview}
        containerStyle={styles.webview}
        accessibilityLabel={accessibilityLabel}
        // navigation / storage / device-API lockdown (webviewConfig.ts, keep native prop types!)
        {...LOCKED_WEBVIEW_PROPS}
        onShouldStartLoadWithRequest={(req) => isAllowedNavigation(req.url)}
        // --- messaging
        onMessage={(e: WebViewMessageEvent) => onMessage(e.nativeEvent.data)}
        onLoadEnd={onLoaded}
        onRenderProcessGone={() => onCrash(tr('sandbox.frame.crash'))}
        onContentProcessDidTerminate={() => onCrash(tr('sandbox.frame.crash'))}
        // --- scroll only when capped
        scrollEnabled={scrollEnabled}
        nestedScrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={scrollEnabled}
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: 'transparent' },
});
