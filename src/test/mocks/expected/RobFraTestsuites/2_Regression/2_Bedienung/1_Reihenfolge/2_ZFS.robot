*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-329
Metadata    Name    ZFS
Metadata    Numbering    1.2.2.1.2
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
iTB-TC-329-PC-1651
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Sondermodell wählen    Sondermodell=Jazz
        Select Special Model    Jazz
    [Teardown]    Teardown-iTB-TC-329-PC-1651


*** Keywords ***
Teardown-iTB-TC-329-PC-1651
    # Endpreis prüfen    Endpreis=17,039.00
        Verify Total Price    17,039.00    €
    # CarConfig beenden
        Close CarConfig

