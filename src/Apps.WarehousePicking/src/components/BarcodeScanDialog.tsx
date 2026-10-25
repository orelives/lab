import { useEffect, useRef, useState } from "react";
import { Lab_warehouseitemsService } from "@/generated/services/Lab_warehouseitemsService";
import { OpenFoodFactsService } from "@/generated/services/OpenFoodFactsService";
import type { Product } from "@/generated/models/OpenFoodFactsModel";
import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";
import {
  Button,
  Card,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Subtitle2,
} from "@fluentui/react-components";
import { BarcodeScannerRegular } from "@fluentui/react-icons";
import { useBarcodeCamera } from "@/hooks/UseBarcodeCamera";
import { useToast } from "@/hooks/use-toast";
import { toBytes, bytesToDataUrl, imageMimeType } from "@/utils/Binary";
import { eanError } from "@/utils/Barcode";
import { ensureProductRecord } from "@/utils/BarcodeLookup";
import { servicePayload, serviceResult } from "@/utils/ServicePayload";
import { errorText } from "@/utils/StockTransactions";
import { useStyles } from "@/styles/BarcodeScanDialog.styles";

type BarcodeScanDialogProps = {
  itemId: string;
  /** The item's current lab_productid_value, if it's already linked to a Product. */
  currentProductId?: string;
  onLinked: () => void;
};

// A camera scan and a manually-typed EAN both end up going through the same handleEan path -
// there's exactly one place that decides what a barcode means. The manual input is also the
// only way to drive this in CI/Playwright, which has no camera: see 11-tests-ui for how the
// test hook types into the scan-ean-input and clicks scan-lookup-button directly, skipping
// the camera.
export default function BarcodeScanDialog({ itemId, currentProductId, onLinked }: BarcodeScanDialogProps) {
  const styles = useStyles();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [ean, setEan] = useState("");
  const eanMessage = eanError(ean);
  const [looking, setLooking] = useState(false);
  const [linking, setLinking] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [imgError, setImgError] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  // The image proxied through the connector for the barcode just looked up: a data: URI for
  // preview, and the bytes it came from so linkProduct() can upload them without re-fetching.
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [imageError, setImageError] = useState(false);
  // A callback ref, not useRef: the decode effect must not start before the <video> is
  // actually mounted, and state (unlike a ref) retriggers the effect once it is.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  // A camera decode and a manual lookup can resolve in either order - once one of them has
  // already produced a product, a late/stray camera decode (e.g. a misread off a bad frame)
  // must not silently overwrite it.
  const productFoundRef = useRef(false);
  const lookupInProgressRef = useRef(false);

  // A fresh scan starts every time the dialog opens
  useEffect(() => {
    if (open) productFoundRef.current = false;
  }, [open]);

  // The camera (see use-barcode-camera: back camera, skips anything that isn't a plausible barcode,
  // stops itself); with no camera the manual input below is the fallback either way
  const cameraError = useBarcodeCamera(videoEl, open, (text) => {
    if (productFoundRef.current || lookupInProgressRef.current) return;
    setEan(text);
    void handleEan(text);
  });

  const handleEan = async (barcode: string) => {
    const normalizedBarcode = barcode.trim();
    if (!normalizedBarcode || eanError(normalizedBarcode) || lookupInProgressRef.current) return;
    lookupInProgressRef.current = true;
    setLooking(true);
    setEan(normalizedBarcode);
    setProduct(null);
    setImgError(false);
    setImageError(false);
    setPreviewImageUrl(null);
    setImageBytes(null);
    try {
      const result = await OpenFoodFactsService.GetProductByBarcode(normalizedBarcode);
      if (!result.success || !result.data) {
        const message = result.error?.message ?? "";
        toast.error(message.includes("No product found for this barcode")
          ? "No product found for this barcode"
          : errorText(message || "Product lookup failed"));
        return;
      }
      setProduct(result.data);
      productFoundRef.current = true;
      // The barcode lookup itself is what "Look Up" promises - stop its spinner here and let
      // the (much slower, since it redirects through a different host) image fetch run with
      // its own loading state, so the button doesn't look stuck while the photo comes in.
      setLooking(false);

      if (result.data.imageUrl) {
        // A code app's CSP can block an <img> pointed at an external URL - proxy the bytes
        // through the connector instead, then render them from a data: URI.
        setImageLoading(true);
        try {
          const bytes = await fetchProductImageBytes(result.data.imageUrl);
          if (bytes) {
            setImageBytes(bytes);
            setPreviewImageUrl(bytesToDataUrl(bytes, imageMimeType(bytes)));
          } else {
            setImageError(true);
          }
        } catch {
          // The image is a nice-to-have on top of the product info already surfaced - fall
          // back to the "no image" state rather than failing the whole lookup over it.
          setImageError(true);
        } finally {
          setImageLoading(false);
        }
      }
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      lookupInProgressRef.current = false;
      setLooking(false);
    }
  };

  const fetchProductImageBytes = async (imageUrl: string): Promise<Uint8Array | null> => {
    const result = await OpenFoodFactsService.GetProductImage(imageUrl);
    if (!result.success || !result.data) return null;
    return toBytes(result.data);
  };

  const linkProduct = async () => {
    if (!product || !ean) return;
    const barcode = ean.trim();
    setLinking(true);
    try {
      const productId = await ensureProductRecord(barcode, product);

      if (!productId) {
        throw new Error("Could not resolve a Product record to link");
      }

      await serviceResult(Lab_warehouseitemsService.update(itemId, servicePayload({
        "lab_productid@odata.bind": `/lab_products(${productId})`,
      })));

      if (imageBytes) {
        try {
          // The generated services cover create/update/get but emit nothing for file columns -
          // the runtime client does, and it takes the bytes directly. It reports failures as
          // { success: false } rather than throwing, so the result has to be checked.
          const upload = await getClient(dataSourcesInfo).uploadFileToRecord(
            "lab_products",
            productId,
            "lab_productimage",
            `${barcode}.${imageMimeType(imageBytes) === "image/png" ? "png" : "jpg"}`,
            imageBytes
          );
          if (!upload.success) {
            throw upload.error ?? new Error("upload rejected");
          }
        } catch (err) {
          // The product is linked either way - only the photo failed to save, so this is a
          // warning, not a failure of the whole action.
          toast.error("Product linked, but its image failed to save: " + errorText(err));
        }
      } else if (product.imageUrl) {
        toast.error("Product linked, but its image failed to save because it could not be downloaded.");
      }

      toast.success("Product linked to item");
      onLinked();
      resetAndClose();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setLinking(false);
    }
  };

  const resetAndClose = () => {
    setOpen(false);
    setEan("");
    setProduct(null);
    setPreviewImageUrl(null);
    setImageBytes(null);
    setImageError(false);
    productFoundRef.current = false;
    lookupInProgressRef.current = false;
  };

  return (
    <>
      <Button
        appearance="outline"
        size="small"
        icon={<BarcodeScannerRegular />}
        data-testid="scan-barcode-button"
        onClick={() => setOpen(true)}
      >
        {currentProductId ? "Rescan Barcode" : "Scan Barcode"}
      </Button>

      <Dialog open={open} onOpenChange={(_, data) => (data.open ? setOpen(true) : resetAndClose())}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Scan Product Barcode</DialogTitle>

            <DialogContent className={styles.content}>
              <video
                ref={setVideoEl}
                className={styles.video}
                muted
                autoPlay
                playsInline
              />

              {cameraError && (
                <Caption1 className={styles.muted}>
                  Camera unavailable: {cameraError} You can still type the barcode below.
                </Caption1>
              )}

              <Field
                label="EAN / UPC barcode"
                validationState={eanMessage ? "error" : "none"}
                validationMessage={eanMessage}
              >
                <div className={styles.eanRow}>
                  <div className={styles.eanInput}>
                    <Input
                      id="scanEan"
                      data-testid="scan-ean-input"
                      value={ean}
                      placeholder="e.g. 3017620422003"
                      onChange={(_, data) => setEan(data.value)}
                    />
                  </div>
                  <Button
                    type="button"
                    appearance="primary"
                    data-testid="scan-lookup-button"
                    disabled={!ean || !!eanMessage || looking}
                    onClick={() => void handleEan(ean)}
                  >
                    {looking ? <Spinner size="tiny" /> : "Look Up"}
                  </Button>
                </div>
              </Field>

              {product && (
                <Card className={styles.product}>
                  {imageLoading && (
                    <div className={styles.imagePlaceholder}>
                      <Spinner size="tiny" />
                    </div>
                  )}
                  {previewImageUrl && !imgError && (
                    <img
                      src={previewImageUrl}
                      alt={product.name ?? ean}
                      className={styles.image}
                      onError={() => setImgError(true)}
                    />
                  )}
                  {imageError && <Caption1 className={styles.muted}>Image preview unavailable.</Caption1>}
                  <div className={styles.productText}>
                    <Subtitle2 data-testid="scan-product-name">
                      {product.name ?? "Unknown product"}
                    </Subtitle2>
                    <Caption1 className={styles.muted}>
                      {[product.brand, product.quantity].filter(Boolean).join(" · ")}
                    </Caption1>
                  </div>
                </Card>
              )}
            </DialogContent>

            <DialogActions>
              <Button type="button" appearance="secondary" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button
                type="button"
                appearance="primary"
                data-testid="scan-link-button"
                disabled={!product || linking}
                onClick={() => void linkProduct()}
              >
                {linking ? <Spinner size="tiny" /> : "Link to Item"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
