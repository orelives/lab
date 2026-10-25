import { useState } from "react";
import { ItemPicker } from "@/components/mobile/ItemPicker";
import { NewItemDialog } from "@/components/mobile/NewItemDialog";
import type { PickItem } from "@/hooks/UsePickItems";

type ReceiveItemChooserProps = {
  onSelect: (item: PickItem) => void;
};

// The first step of Receive: choose an existing item by name or SKU, or create it by name.
export function ReceiveItemChooser({ onSelect }: ReceiveItemChooserProps) {
  const [isNewItemOpen, setIsNewItemOpen] = useState(false);
  const [newItemName, setNewItemName] = useState<string | undefined>();

  return (
    <div>
      <ItemPicker
        onSelect={onSelect}
        onCreate={(search) => {
          setNewItemName(search);
          setIsNewItemOpen(true);
        }}
      />

      <NewItemDialog
        open={isNewItemOpen}
        onOpenChange={(open) => {
          setIsNewItemOpen(open);
          if (!open) setNewItemName(undefined);
        }}
        defaults={{ name: newItemName }}
        onCreated={(item) => {
          setIsNewItemOpen(false);
          setNewItemName(undefined);
          onSelect(item);
        }}
      />
    </div>
  );
}
