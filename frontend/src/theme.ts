import { defaultSeed } from 'antd/es/theme';

// Simple light and dark theme token overrides for Ant Design 5
export const light = {
  token: {
    colorPrimary: '#1890ff',
    borderRadius: 4,
    fontSize: 14,
    // add more token overrides as needed
  },
  // you can also customize components here
};

export const dark = {
  token: {
    colorPrimary: '#177ddc',
    borderRadius: 4,
    fontSize: 14,
    colorBgBase: '#141414',
    colorTextBase: '#ffffff',
  },
  // optionally set algorithm: 'dark'
};
