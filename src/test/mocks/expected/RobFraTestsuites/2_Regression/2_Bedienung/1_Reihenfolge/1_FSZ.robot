*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-325
Metadata    Name    FSZ
Metadata    Numbering    1.2.2.1.1
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
iTB-TC-325-PC-1647
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
    # Zubehör wählen    Zubehör(Liste)=0,00
        Select Accessory    0,00
    # Endpreis prüfen    Endpreis=Sportfelgen
        Verify Total Price    Sportfelgen    €
    # Endpreis prüfen    Endpreis=ABS
        Verify Total Price    ABS    €
    # CarConfig beenden
        Close CarConfig
