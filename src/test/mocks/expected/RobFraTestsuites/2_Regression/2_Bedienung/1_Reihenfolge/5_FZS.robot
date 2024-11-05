*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-326
Metadata    Name    FZS
Metadata    Numbering    1.2.2.1.5
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
iTB-TC-326-PC-1648
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
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Sondermodell wählen    Sondermodell=Jazz
        Select Special Model    Jazz
    # Endpreis prüfen    Endpreis=17,039.00
        Verify Total Price    17,039.00    €
    # CarConfig beenden
        Close CarConfig
