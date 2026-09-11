# SynapseNest Android app

The product is a PWA at `/workspace`. Chrome can install it as an Android app.

To build a signed APK / TWA from this folder:

```bash
npx @bubblewrap/cli init --manifest https://synapsenest-edge.core-ao.workers.dev/manifest.webmanifest
npx @bubblewrap/cli build
```

The generated APK lands in `android/app/build/outputs/apk/`.
