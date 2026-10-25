import { useState } from "react";
import { Button, MessageBar, MessageBarBody } from "@fluentui/react-components";
import { Lab_warehouseitemsService } from "@/generated/services/Lab_warehouseitemsService";
import { ItemPicker } from "@/components/mobile/ItemPicker";
import { ItemSummary } from "@/components/mobile/ItemSummary";
import { MobilePage } from "@/components/mobile/MobilePage";
import { QuantityStepper } from "@/components/mobile/QuantityStepper";
import { ReceiveItemChooser } from "@/components/mobile/ReceiveItemChooser";
import { ResultPanel } from "@/components/mobile/ResultPanel";
import type { PickItem } from "@/hooks/UsePickItems";
import { errorText, useStockTransaction } from "@/utils/StockTransactions";
import { useStyles } from "@/styles/QuickTransaction.styles";
import { serviceResult } from "@/utils/ServicePayload";

type Mode = "receive" | "pick";

const CONFIG = {
  receive: { title: "Receive stock", verb: "Receive", past: "Received", type: "inbound" },
  pick: { title: "Pick stock", verb: "Pick", past: "Picked", type: "outbound" },
} as const;

// Receive and Pick are the same flow in opposite directions: choose an item, set a quantity, confirm.
// The server keeps the item's quantity in step and decides whether the transaction is allowed.
function QuickTransactionFlow({ mode }: { mode: Mode }) {
  const styles = useStyles();
  const config = CONFIG[mode];
  const stock = useStockTransaction();
  const [item, setItem] = useState<PickItem | null>(null);
  const [quantity, setQuantity] = useState<number | null>(1);
  const [result, setResult] = useState<{ title: string; detail: string } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const restart = () => {
    setItem(null);
    setQuantity(1);
    setResult(null);
    setRefreshError(null);
    stock.reset();
  };

  if (result) {
    return (
      <MobilePage title={config.title}>
        <ResultPanel title={result.title} detail={result.detail} onAgain={restart} />
        {refreshError && (
          <MessageBar intent="error">
            <MessageBarBody>{refreshError}</MessageBarBody>
          </MessageBar>
        )}
      </MobilePage>
    );
  }

  if (!item) {
    return (
      <MobilePage title={config.title}>
        {mode === "receive" ? <ReceiveItemChooser onSelect={setItem} /> : <ItemPicker onSelect={setItem} />}
      </MobilePage>
    );
  }

  const valid = quantity !== null;

  const confirm = async () => {
    if (!valid) return;
    try {
      await stock.mutateAsync({
        itemId: item.id,
        itemName: item.name,
        type: config.type,
        quantity,
        label: config.verb,
      });
    } catch {
      return;
    }

    try {
      const refreshed = await serviceResult(Lab_warehouseitemsService.get(item.id));
      const available = Number(refreshed.data?.lab_availablequantity);
      setResult({
        title: `${config.past} ${quantity}`,
        detail: `${item.name} - ${available} on hand now`,
      });
    } catch (error) {
      setRefreshError(errorText(error));
      setResult({
        title: `${config.past} ${quantity}`,
        detail: `${item.name} - the transaction was saved, but current stock could not be refreshed.`,
      });
    }
  };

  return (
    <MobilePage
      title={config.title}
      footer={
        <Button
          className={styles.confirm}
          appearance="primary"
          size="large"
          disabled={!valid || stock.isPending}
          onClick={() => void confirm()}
          data-testid="flow-confirm"
        >
          {stock.isPending ? "Saving..." : valid ? `${config.verb} ${quantity}` : config.verb}
        </Button>
      }
    >
      <ItemSummary item={item} onChange={restart} />
      <QuantityStepper
        id="quick-quantity"
        label="Quantity"
        value={quantity}
        onChange={setQuantity}
        min={0}
        hint={quantity === null ? "Enter how many" : undefined}
      />
      {stock.error && (
        <MessageBar intent="error">
          <MessageBarBody>{errorText(stock.error)}</MessageBarBody>
        </MessageBar>
      )}
    </MobilePage>
  );
}

// Keyed by mode so switching between /receive and /pick never carries an item or quantity over
export default function QuickTransactionPage({ mode }: { mode: Mode }) {
  return <QuickTransactionFlow key={mode} mode={mode} />;
}
