# Vendored Teact runtime

This directory contains the minimum Teact runtime used by the extension UI.
It is derived exclusively from [Ajaxy/teact](https://github.com/Ajaxy/teact)
at commit `c822425ca286466c51d04e35fe2acff506437ee5`, under the MIT license in
`LICENSE`.

Local modifications remove the runtime's FasterDOM, generalized schedulers,
debug overlay, and heavy-animation integration, use one direct
`requestAnimationFrame` update pass, and remove the
build-specific `process.env.APP_ENV` branch. The style prop also accepts the
typed object form used by TSX. No source, styles, or assets from
the GPL-licensed Telegram Web A application are included.
