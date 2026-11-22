import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'KMOverlay Translate',
    description: 'Traduz balões de HQ e o texto das páginas no lugar, usando um servidor local.',
    // `scripting` registers the content script only on the sites the user turns on.
    permissions: ['storage', 'activeTab', 'scripting'],
    // The default local server is always reachable; any other server address is
    // requested at runtime from the options page.
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      'toggle-original': {
        suggested_key: { default: 'Alt+T' },
        description: 'Alternar original e tradução',
      },
      'toggle-site': {
        suggested_key: { default: 'Alt+Shift+K' },
        description: 'Ligar ou desligar no site atual',
      },
    },
  },
});
