# 63 Kleinen Bug fixen: Änderung als Diff (```diff-Fence, nur Anzeige)

Router-Hint: `UI-ROUTER-HINT: format=diff confidence=0.9 - Codeänderung`

Nutzer: Der Warenkorb zeigt manchmal "NaN €" an, wenn ein Artikel keinen Preis hat. Kannst du das fixen?

Assistent (1-2 Sätze Ergebnis, die Änderung als normaler unified diff in einer ```diff-Fence, kein hui-Wrapper):
````markdown
Der Preis eines Artikels ohne Angabe war `undefined`, die Summe wurde dadurch zu `NaN`. Jetzt zählt so ein Artikel als 0 €, und die Anzeige formatiert nur gültige Zahlen.

```diff
--- a/src/cart/total.ts
+++ b/src/cart/total.ts
@@ -3,6 +3,6 @@ export interface Item { name: string; price?: number; qty: number }
 
 export function cartTotal(items: Item[]): number {
   let sum = 0;
-  for (const it of items) sum += it.price * it.qty;
+  for (const it of items) sum += (it.price ?? 0) * it.qty;
   return sum;
 }
--- a/src/cart/format.ts
+++ b/src/cart/format.ts
@@ -1,3 +1,4 @@
 export function formatEuro(value: number): string {
+  if (!Number.isFinite(value)) return '–';
   return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
 }
```
````
