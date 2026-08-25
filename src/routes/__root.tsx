import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'
import Footer from '../components/Footer'
import Header from '../components/Header'
import { ChatModeProvider, useChatMode } from '../lib/chat-mode'
import { ChatModeToggle } from '../components/text-chat/ChatModeToggle'
import { TextChatPanel } from '../components/text-chat/TextChatPanel'
import { AppProviders } from '../lib/query-provider'
import { VoiceOverlay } from '../components/voice/VoiceOverlay'

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Orole-OS',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
})

/** Renders the text chat overlay while in backup (text) mode. */
function TextModeGate({ children }: { children: React.ReactNode }) {
  const { mode } = useChatMode()
  return (
    <>
      {children}
      {mode === 'text' && <TextChatPanel />}
    </>
  )
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="dark font-sans antialiased [overflow-wrap:anywhere] selection:bg-neon-cyan/20">
        <AppProviders>
            <ChatModeProvider>
              <Header />
              <ChatModeToggle className="fixed right-4 top-20 z-40" />
              <TextModeGate>{children}</TextModeGate>
              <Footer />
              <VoiceOverlay />
            </ChatModeProvider>
        </AppProviders>
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}
