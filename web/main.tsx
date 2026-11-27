import '@mantine/core/styles.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/index.css';
import {createTheme, MantineProvider, Modal} from '@mantine/core';
import {createRoot} from 'react-dom/client';
import {Studio} from './studio.tsx';

const theme = createTheme({
  fontFamily: 'Inter Variable, system-ui, sans-serif',
  defaultRadius: 'md',
  respectReducedMotion: true,
  components: {
    Modal: Modal.extend({defaultProps: {centered: true, closeButtonProps: {'aria-label': 'Close dialog'}}}),
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing Short Studio root element.');
const appRoot = import.meta.hot?.data.root ?? createRoot(root);
if (import.meta.hot) import.meta.hot.data.root = appRoot;
appRoot.render(
  <MantineProvider theme={theme} forceColorScheme="dark">
    <Studio />
  </MantineProvider>,
);
