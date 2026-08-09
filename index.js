import { registerRootComponent } from 'expo';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';
import { LocalPdfParserProvider } from './src/LocalPdfParserProvider';
import { UsosWebViewLoginProvider } from './src/UsosWebViewLoginProvider';

function Root() {
  return (
    <SafeAreaProvider>
      <LocalPdfParserProvider>
        <UsosWebViewLoginProvider>
          <App />
        </UsosWebViewLoginProvider>
      </LocalPdfParserProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(Root);
