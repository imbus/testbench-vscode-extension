*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-338
Metadata    Name    Sondermodellbestandteile
Metadata    Numbering    1.2.3.1.1
Test Tags    Demo    Systemtest    Automatisiert    Betriebssystem:beide


*** Test Cases ***
iTB-TC-338-PC-1660
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Sondermodell wählen    Sondermodell=Gomera
        Select Special Model    Gomera
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    # Zubehör wählen    Zubehör(Liste)=Fensterheber hinten
        Select Accessory    Fensterheber hinten
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Endpreis prüfen    Endpreis=17,313.00
        Verify Total Price    17,313.00    €
    # CarConfig beenden
        Close CarConfig

iTB-TC-338-PC-1661
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Sondermodell wählen    Sondermodell=Jazz
        Select Special Model    Jazz
    # Zubehör wählen    Zubehör(Liste)=Radio mit CD-Wechsler
        Select Accessory    Radio mit CD-Wechsler
    # Zubehör wählen    Zubehör(Liste)=Fußmatten
        Select Accessory    Fußmatten
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Endpreis prüfen    Endpreis=16,049.00
        Verify Total Price    16,049.00    €
    # CarConfig beenden
        Close CarConfig

iTB-TC-338-PC-1662
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Sondermodell wählen    Sondermodell=Luxus
        Select Special Model    Luxus
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Zubehör wählen    Zubehör(Liste)=Fensterheber hinten
        Select Accessory    Fensterheber hinten
    # Zubehör wählen    Zubehör(Liste)=Radio mit CD-Wechsler
        Select Accessory    Radio mit CD-Wechsler
    # Endpreis prüfen    Endpreis=17,499.99
        Verify Total Price    17,499.99    €
    # CarConfig beenden
        Close CarConfig

iTB-TC-338-PC-195545
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Sondermodell wählen    Sondermodell=Keine
        Select Special Model    Keine
    # Endpreis prüfen    Endpreis=0.00
        Verify Total Price    0.00    €
    # CarConfig beenden
        Close CarConfig
