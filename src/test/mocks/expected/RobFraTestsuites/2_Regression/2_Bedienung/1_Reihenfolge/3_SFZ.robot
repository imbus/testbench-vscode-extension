*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-327
Metadata    Name    SFZ
Metadata    Numbering    1.2.2.1.3
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
iTB-TC-327-PC-1649
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Sondermodell wählen    Sondermodell=Jazz
        Select Special Model    Jazz
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Endpreis prüfen    Endpreis=17,039.00
        Verify Total Price    17,039.00    €
    # CarConfig beenden
        Close CarConfig
