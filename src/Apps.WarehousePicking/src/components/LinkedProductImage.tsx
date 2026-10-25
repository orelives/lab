import { useEffect, useState } from "react";
import { getClient } from "@microsoft/power-apps/data";
import { dataSourcesInfo } from "../../.power/schemas/appschemas/dataSourcesInfo";
import { bytesToDataUrl, imageMimeType } from "@/utils/Binary";
import { useStyles } from "@/styles/LinkedProductImage.styles";
import { useToast } from "@/hooks/use-toast";
import { errorText } from "@/utils/StockTransactions";

const client = getClient(dataSourcesInfo);

type LinkedProductImageProps = {
  productId: string;
};

// No generated service method downloads a file column's bytes - only upload() is generated -
// so this goes through the low-level client directly, the same one the generated services
// themselves are built on.
export default function LinkedProductImage({ productId }: LinkedProductImageProps) {
  const styles = useStyles();
  const toast = useToast();
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);

    client
      .downloadFileFromRecord("lab_products", productId, "lab_productimage")
      .then((result) => {
        if (cancelled) return;
        if (!result.success) {
          toast.error(errorText(result.error?.message ?? "Unable to load the product image."));
          return;
        }
        if (!result.data?.length) return;
        setImageUrl(bytesToDataUrl(result.data, imageMimeType(result.data)));
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(errorText(error));
      });

    return () => {
      cancelled = true;
    };
  }, [productId, toast]);

  if (!imageUrl) return null;

  return (
    <img
      src={imageUrl}
      alt=""
      className={styles.image}
      onError={() => setImageUrl(null)}
    />
  );
}
