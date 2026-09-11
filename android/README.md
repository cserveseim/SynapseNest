# SynapseNest Android app

PWA: Chrome → Install app.

Sideload APK (Trusted Web Activity wrapping the live workspace):

https://synapsenest-edge.core-ao.workers.dev/downloads/synapsenest.apk

Package `com.synapsenest.app`. Enable **Install unknown apps** for your browser.

Rebuild:

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_SDK_ROOT=/opt/android-sdk
cd android/twa
/tmp/gradle-8.4/bin/gradle assembleRelease --no-daemon
cp app/build/outputs/apk/release/app-release.apk ../../public/downloads/synapsenest.apk
```
