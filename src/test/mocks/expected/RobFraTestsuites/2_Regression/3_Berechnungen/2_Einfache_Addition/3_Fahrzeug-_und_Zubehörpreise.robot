*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    itb-TC-19622
Metadata    Name    Fahrzeug- und Zubehörpreise
Metadata    Numbering    1.2.3.2.3
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
itb-TC-19622-PC-119739
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
    # Zubehör wählen    Zubehör(Liste)=Lederlenkrad
        Select Accessory    Lederlenkrad
    # Endpreis prüfen    Endpreis=15,360.00
        Verify Total Price    15,360.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119738
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
    # Zubehör wählen    Zubehör(Liste)=Beheizbarer Außenspiegel
        Select Accessory    Beheizbarer Außenspiegel
    # Endpreis prüfen    Endpreis=15,210.00
        Verify Total Price    15,210.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119737
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
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    # Endpreis prüfen    Endpreis=16,200.00
        Verify Total Price    16,200.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119736
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
    # Endpreis prüfen    Endpreis=15,900.00
        Verify Total Price    15,900.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119743
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
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Endpreis prüfen    Endpreis=15,990.00
        Verify Total Price    15,990.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119742
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
    # Zubehör wählen    Zubehör(Liste)=Fensterheber hinten
        Select Accessory    Fensterheber hinten
    # Endpreis prüfen    Endpreis=15,490.00
        Verify Total Price    15,490.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119741
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
    # Zubehör wählen    Zubehör(Liste)=Radio mit CD-Wechsler
        Select Accessory    Radio mit CD-Wechsler
    # Endpreis prüfen    Endpreis=15,470.00
        Verify Total Price    15,470.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19622-PC-119740
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
    # Zubehör wählen    Zubehör(Liste)=Fußmatten
        Select Accessory    Fußmatten
    # Endpreis prüfen    Endpreis=15,026.00
        Verify Total Price    15,026.00    €
    # CarConfig beenden
        Close CarConfig
