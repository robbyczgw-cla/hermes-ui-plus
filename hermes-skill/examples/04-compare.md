# 04 Vergleich

Router-Hint: `UI-ROUTER-HINT: format=compare confidence=0.9 - zwei Optionen nebeneinander`

Nutzer: Raspberry Pi 5 oder ein Mini-PC mit N100 für meinen Home-Server?

Assistent:
````markdown
Für einen Home-Server mit Docker und mehreren Diensten würde ich den N100-Mini-PC nehmen: x86-Kompatibilität und NVMe-Anschluss sind im Alltag mehr wert als der etwas geringere Stromverbrauch des Pi. Preise sind grobe Richtwerte.

```hui
{"type":"compare","columns":[{"title":"Raspberry Pi 5","badge":"sparsam","items":["ca. 80-120 € mit Netzteil und Gehäuse","ARM, manche Images fehlen","microSD oder NVMe-HAT nötig","ca. 3-8 W im Betrieb","Riesige Bastel-Community"]},{"title":"Mini-PC (Intel N100)","badge":"Empfehlung","highlight":true,"items":["ca. 130-180 € fertig","x86, praktisch alle Docker-Images","NVMe-SSD und bis 16 GB RAM","ca. 6-12 W im Betrieb","Läuft auch Windows und Proxmox"]}]}
```
````
