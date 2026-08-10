# Home v2 product marks

These assets are local product artwork, not QDN app favicons.

- `qortium-protoicon-black-transparent.webp` is the unchanged Qortium master
  supplied from
  `/home/user/Downloads/qortium-docs/final/qortium-protoicon-black-transparent.webp`.
- `qortal-from-qortium-spokes-removed.svg` is the unchanged Qortal SVG master
  supplied from
  `/home/user/Downloads/qortium-docs/final/qortal-from-qortium-spokes-removed.svg`.
- `qortium-protoicon-color-mask.webp` preserves the black geometry and converts
  luminance into alpha so CSS can render the mark with the fixed Qortium color.
- `qortal-from-qortium-color-mask.svg` preserves only the original black
  geometry for the same CSS masking use.

The Qortium mask was generated from the lossless master with:

```sh
magick qortium-protoicon-black-transparent.webp \
  -channel A -fx 'a*(1-r)' +channel \
  -define webp:lossless=true qortium-protoicon-color-mask.webp
```

The canonical Home mark remains
`src/assets/icons/qortium-home-protoicon-thick-interior.png`; it is also the
source for the packaged desktop and Android launcher assets.
