import glob
import xml.etree.ElementTree as ET

path = glob.glob("dumps/Shufersal_stores/*.xml")[0]
tree = ET.parse(path)
root = tree.getroot()

wanted = {"1", "2", "001", "002"}
for store in root.iter("Store"):
    sid = (store.findtext("StoreID") or "").lstrip("0") or "0"
    if sid in {"1", "2"}:
        print(
            f"StoreID={store.findtext('StoreID')} | {store.findtext('StoreName')} | "
            f"{store.findtext('Address')}, city_code={store.findtext('City')}, zip={store.findtext('ZIPCode')}"
        )
