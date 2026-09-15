import { render, screen } from '@testing-library/react-native';
import React from 'react';

import HowItWorks from '@/app/how-it-works';
import { HOW_IT_WORKS } from '@/lib/how-it-works';

// A page to read, and the one promise it makes: every rule the app runs on is on it.

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
}));

describe('How it works', () => {
  it('draws every section, title and words', () => {
    render(<HowItWorks />);
    expect(HOW_IT_WORKS.length).toBeGreaterThan(8);
    for (const section of HOW_IT_WORKS) {
      expect(screen.getByText(section.title)).toBeTruthy();
      expect(screen.getByText(section.body)).toBeTruthy();
    }
  });

  it('names the numbers the code actually runs on', () => {
    // The page exists because the coverage map left someone asking whether it resets on a
    // Monday. If these figures drift out of the copy, the page has stopped being true.
    const all = HOW_IT_WORKS.map((section) => section.body).join(' ');
    expect(all).toContain('seven-day');
    expect(all).toContain('10 to 20 sets');
    expect(all).toContain('48 hours');
    expect(all).toContain('150 minutes');
    expect(all).toContain('45 lb bar');
  });

  it('has nothing on it to press but the way back', () => {
    render(<HowItWorks />);
    expect(screen.getByTestId('how-it-works-back')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
