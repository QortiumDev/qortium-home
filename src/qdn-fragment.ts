export type QdnFragmentSplit = {
  fragment: string;
  location: string;
};

/**
 * Split a browser-only URL fragment from the QDN location used to identify and
 * fetch a resource. The fragment is stored without its leading `#` so it can
 * never be mistaken for a Core filepath or query parameter.
 */
export function splitQdnFragment(value: string): QdnFragmentSplit {
  const fragmentIndex = value.indexOf('#');

  if (fragmentIndex === -1) {
    return { fragment: '', location: value };
  }

  return {
    fragment: value.slice(fragmentIndex + 1),
    location: value.slice(0, fragmentIndex),
  };
}

export function appendQdnFragment(value: string, fragment: string | undefined) {
  return fragment ? `${value}#${fragment}` : value;
}
