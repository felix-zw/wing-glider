# Basis Universal GPU Texture Compression

Basis Universal is a "[supercompressed](http://gamma.cs.unc.edu/GST/gst.pdf)"
GPU texture and texture video compression system that outputs a highly
compressed intermediate file format (.basis) that can be quickly transcoded to
a wide variety of GPU texture compression formats.

[GitHub](https://github.com/BinomialLLC/basis_universal)

## Transcoders

Basis Universal texture data may be used in two different file formats:
`.basis` and `.ktx2`, where `ktx2` is a standardized wrapper around basis texture data.

For further documentation about the Basis compressor and transcoder, refer to
the [Basis GitHub repository](https://github.com/BinomialLLC/basis_universal).

The folder contains two files required for transcoding `.basis` or `.ktx2` textures:

* `basis_transcoder.js` — JavaScript wrapper for the WebAssembly transcoder.
* `basis_transcoder.wasm` — WebAssembly transcoder.

Both are dependencies of `KTX2Loader`:

```js
const ktx2Loader = new KTX2Loader();
ktx2Loader.setTranscoderPath( 'examples/jsm/libs/basis/' );
ktx2Loader.detectSupport( renderer );
ktx2Loader.load( 'diffuse.ktx2', function ( texture ) {

	const material = new THREE.MeshStandardMaterial( { map: texture } );

}, function () {

	console.log( 'onProgress' );

}, function ( e ) {

	console.error( e );

} );
```

## License

[Apache License 2.0](https://github.com/BinomialLLC/basis_universal/blob/master/LICENSE)

## Wing Glider distribution

`basis_transcoder.js` and `basis_transcoder.wasm` are vendored from Three.js
0.180.0's `examples/jsm/libs/basis/` directory without modifications. They are
served locally so compressed game textures do not require a CDN.

The upstream [LICENSE](./LICENSE) and [NOTICE](./NOTICE) are included in this
directory. These notice files were retrieved from Basis Universal revision
`1aab02ba2df16ad873229030ea191ea8c10e3fc9`.

The separate, optional build-time encoder is downloaded by
`tools/fetch-art-tools.ps1` from the same pinned Basis Universal revision. It is
cached under `tmp/art-tools/`, is not shipped with the game, and is verified
against a pinned SHA-256 before use. See `art/ASSETS.md` for the reproducible
texture-generation workflow.
