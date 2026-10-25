import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { Result } from "@zxing/library";

export function useBarcodeCamera(
  video: HTMLVideoElement | null,
  enabled: boolean,
  onBarcode: (barcode: string) => void
) {
  const onBarcodeRef = useRef(onBarcode);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onBarcodeRef.current = onBarcode;
  }, [onBarcode]);

  useEffect(() => {
    if (!enabled || !video) return;

    let disposed = false;
    let decoded = false;
    let stopScanner: (() => void) | undefined;
    const reader = new BrowserMultiFormatReader();
    setError(null);

    void reader.decodeFromVideoDevice(undefined, video, (result: Result | undefined) => {
      if (disposed || decoded || !result) return;
      decoded = true;
      stopScanner?.();
      onBarcodeRef.current(result.getText());
    }).then((controls) => {
      if (disposed) {
        controls.stop();
      } else {
        stopScanner = controls.stop;
        if (decoded) stopScanner();
      }
    }).catch((cameraError: unknown) => {
      if (!disposed) {
        setError(cameraError instanceof Error ? cameraError.message : String(cameraError));
      }
    });

    return () => {
      disposed = true;
      stopScanner?.();
    };
  }, [enabled, video]);

  return error;
}
