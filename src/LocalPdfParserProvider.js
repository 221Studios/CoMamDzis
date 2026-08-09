import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const PDF_PARSER_TIMEOUT_MS = 60000;

const PDF_HTML_BRIDGE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
</head>
<body>
  <script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

    function post(payload) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }

    async function startPdfExtraction(base64Data) {
      try {
        const raw = window.atob(base64Data);
        const array = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
          array[i] = raw.charCodeAt(i);
        }

        const pdf = await pdfjsLib.getDocument({ data: array }).promise;
        const extractedItems = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();

          textContent.items.forEach((item) => {
            const text = item.str && item.str.trim();
            if (!text) return;
            extractedItems.push({
              text,
              x: item.transform[4],
              y: item.transform[5],
              page: pageNum
            });
          });
        }

        post({ success: true, items: extractedItems });
      } catch (error) {
        post({ success: false, error: error.message || 'Błąd parsowania PDF' });
      }
    }

    function onBridgeMessage(event) {
      let payload = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch (error) {
          post({ success: false, error: 'Niepoprawna wiadomość z aplikacji' });
          return;
        }
      }
      if (payload?.type === 'extract' && payload.base64) {
        startPdfExtraction(payload.base64);
      }
    }

    document.addEventListener('message', onBridgeMessage);
    window.addEventListener('message', onBridgeMessage);
    post({ ready: true });
  </script>
</body>
</html>`;

const LocalPdfParserContext = createContext({
  extractPdfTextLocal: null,
  pdfParserReady: false
});

export function useLocalPdfParser() {
  return useContext(LocalPdfParserContext);
}

export function LocalPdfParserProvider({ children }) {
  const webViewRef = useRef(null);
  const resolverRef = useRef(null);
  const rejectRef = useRef(null);
  const timeoutRef = useRef(null);
  const [pdfParserReady, setPdfParserReady] = useState(false);

  const clearPending = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    resolverRef.current = null;
    rejectRef.current = null;
  }, []);

  const extractPdfTextLocal = useCallback((base64Pdf) => {
    if (!pdfParserReady) {
      return Promise.reject(new Error('Parser PDF nie jest jeszcze gotowy. Spróbuj ponownie za chwilę.'));
    }

    return new Promise((resolve, reject) => {
      clearPending();
      resolverRef.current = resolve;
      rejectRef.current = reject;

      webViewRef.current?.postMessage(JSON.stringify({
        type: 'extract',
        base64: base64Pdf
      }));

      timeoutRef.current = setTimeout(() => {
        clearPending();
        reject(new Error('Przekroczono czas lokalnego przetwarzania pliku PDF.'));
      }, PDF_PARSER_TIMEOUT_MS);
    });
  }, [clearPending, pdfParserReady]);

  const onMessage = useCallback((event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.ready) {
        setPdfParserReady(true);
        return;
      }

      if (!resolverRef.current && !rejectRef.current) return;

      if (data.success && Array.isArray(data.items)) {
        resolverRef.current?.(data.items);
        clearPending();
        return;
      }

      rejectRef.current?.(new Error(data.error || 'Błąd wewnątrz parsera PDF.'));
      clearPending();
    } catch {
      rejectRef.current?.(new Error('Błąd parsowania wiadomości z parsera PDF.'));
      clearPending();
    }
  }, [clearPending]);

  const value = useMemo(() => ({
    extractPdfTextLocal,
    pdfParserReady
  }), [extractPdfTextLocal, pdfParserReady]);

  return (
    <LocalPdfParserContext.Provider value={value}>
      {children}
      <View pointerEvents="none" style={styles.hidden}>
        <WebView
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: PDF_HTML_BRIDGE }}
          onMessage={onMessage}
          javaScriptEnabled
          domStorageEnabled
        />
      </View>
    </LocalPdfParserContext.Provider>
  );
}

const styles = StyleSheet.create({
  hidden: {
    width: 0,
    height: 0,
    opacity: 0,
    position: 'absolute'
  }
});
