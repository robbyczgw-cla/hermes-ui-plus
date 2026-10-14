// Web fallback (react-native-web / gallery previews): sandboxed srcdoc iframe.
// sandbox="allow-scripts" without allow-same-origin => opaque origin: no cookies/storage,
// no access to the host page; no allow-popups / allow-forms / allow-top-navigation.
// Tap signal (actionGate.ts): only taps / keyboard activations the shell reports over a private MessagePort
// (focus is not consent: GPT security M1 / Astra F15). port2 goes to the shell in the first message we ever post
// (before any render, so before any model code runs); the shell keeps it in a closure and stops that message from reaching other listeners.
import { useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { useT } from '../i18n';
import type { HtmlFrameProps } from './frameTypes';
import { FRAME_INIT_MESSAGE, FRAME_TAP_MESSAGE } from './shell';

export function HtmlFrame({ ref, shellHtml, scrollEnabled, onMessage, onLoaded, onTap, scheme, accessibilityLabel }: HtmlFrameProps) {
  const tr = useT();
  const iframe = useRef<HTMLIFrameElement>(null);
  const handlers = useRef({ onMessage, onTap });
  handlers.current = { onMessage, onTap };
  // per mounted document: port2 still to be transferred (null once sent)
  const pendingPort = useRef<MessagePort | null>(null);
  const sendInit = () => {
    const win = iframe.current?.contentWindow;
    const port = pendingPort.current;
    if (!win || !port) return;
    pendingPort.current = null;
    win.postMessage(FRAME_INIT_MESSAGE, '*', [port]);
  };

  useImperativeHandle(
    ref,
    () => ({
      post: (msg) => {
        sendInit(); // same target window, so the init (and its port) is delivered before this message
        iframe.current?.contentWindow?.postMessage(JSON.stringify(msg), '*');
      },
    }),
    [],
  );

  // Layout effect: listener must exist before the srcdoc's `ready` message can arrive.
  useLayoutEffect(() => {
    const channel = new MessageChannel();
    pendingPort.current = channel.port2;
    // only this exact message counts; a "tap" on the normal window channel is dropped by parseSandboxMessage
    channel.port1.onmessage = (e) => {
      if (e.data === FRAME_TAP_MESSAGE) handlers.current.onTap?.();
    };
    const onWindowMessage = (e: MessageEvent) => {
      const win = iframe.current?.contentWindow;
      if (!win || e.source !== win) return;
      sendInit(); // first message from the shell document (`ready`): it is listening now
      handlers.current.onMessage(e.data);
    };
    window.addEventListener('message', onWindowMessage);
    return () => {
      window.removeEventListener('message', onWindowMessage);
      channel.port1.onmessage = null;
      channel.port1.close();
      pendingPort.current = null;
    };
  }, []);

  return (
    <View style={StyleSheet.absoluteFill}>
      <iframe
        ref={iframe}
        srcDoc={shellHtml}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        title={accessibilityLabel ?? tr('sandbox.frame.title')}
        scrolling={scrollEnabled ? 'yes' : 'no'}
        onLoad={onLoaded}
        style={{ border: 0, width: '100%', height: '100%', display: 'block', background: 'transparent', overflow: scrollEnabled ? 'auto' : 'hidden', colorScheme: scheme }}
      />
    </View>
  );
}
