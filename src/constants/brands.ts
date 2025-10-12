export const BRAND_OPTIONS = ['Awtar', '360', 'AA Chicken', 'CallCenter', 'Head Office'] as const;
export type Brand = typeof BRAND_OPTIONS[number];
