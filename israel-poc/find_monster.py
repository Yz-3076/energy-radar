import glob
import xml.etree.ElementTree as ET

files = glob.glob("dumps/Shufersal/*.xml")
print(f"Parsing {len(files)} files...")

for path in files:
    tree = ET.parse(path)
    root = tree.getroot()
    chain_id = root.findtext("ChainID")
    store_id = root.findtext("StoreID")

    hits = []
    for item in root.iter("Item"):
        name = item.findtext("ItemName") or ""
        if "מונסטר" in name or "MONSTER" in name.upper():
            hits.append(
                {
                    "code": item.findtext("ItemCode"),
                    "name": name,
                    "manufacturer": item.findtext("ManufactureName"),
                    "price": item.findtext("ItemPrice"),
                    "qty": item.findtext("Quantity"),
                    "unit": item.findtext("UnitQty"),
                    "last_sale": item.findtext("LastSaleDateTime"),
                    "price_update": item.findtext("PriceUpdateTime"),
                }
            )

    print(f"\n=== {path} (store {store_id}) — {len(hits)} Monster items ===")
    for h in hits:
        print(
            f"  [{h['code']}] {h['name']} | {h['qty']}{h['unit']} | "
            f"₪{h['price']} | mfr={h['manufacturer']} | last_sale={h['last_sale']}"
        )
