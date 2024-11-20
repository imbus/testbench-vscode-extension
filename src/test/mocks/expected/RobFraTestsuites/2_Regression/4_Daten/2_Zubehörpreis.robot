*** Settings ***
Resource    ../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-320
Metadata    Name    Zubehörpreis
Metadata    Numbering    1.2.4.2
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
iTB-TC-320-PC-1622
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
    # Endpreis prüfen    Endpreis=16,890.00
        Verify Total Price    16,890.00    €
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Endpreis prüfen    Endpreis=16,890.00
        Verify Total Price    16,890.00    €
    # CarConfig beenden
        Close CarConfig

iTB-TC-320-PC-1623
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
    # Endpreis prüfen    Endpreis=17,699.60
        Verify Total Price    17,699.60    €
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Zubehör wählen    Zubehör(Liste)=Fensterheber hinten
        Select Accessory    Fensterheber hinten
    # Zubehör wählen    Zubehör(Liste)=Radio mit CD-Wechsler
        Select Accessory    Radio mit CD-Wechsler
    # Zubehör wählen    Zubehör(Liste)=Fußmatten
        Select Accessory    Fußmatten
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    # Endpreis prüfen    Endpreis=17,699.60
        Verify Total Price    17,699.60    €
    # CarConfig beenden
        Close CarConfig

iTB-TC-320-PC-1624
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
    # Endpreis prüfen    Endpreis=18,949.10
        Verify Total Price    18,949.10    €
    # Zubehör wählen    Zubehör(Liste)=Lederlenkrad
        Select Accessory    Lederlenkrad
    # Zubehör wählen    Zubehör(Liste)=Beheizbarer Außenspiegel
        Select Accessory    Beheizbarer Außenspiegel
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    # Zubehör wählen    Zubehör(Liste)=Fensterheber hinten
        Select Accessory    Fensterheber hinten
    # Zubehör wählen    Zubehör(Liste)=Radio mit CD-Wechsler
        Select Accessory    Radio mit CD-Wechsler
    # Zubehör wählen    Zubehör(Liste)=Fußmatten
        Select Accessory    Fußmatten
    # Endpreis prüfen    Endpreis=18,949.10
        Verify Total Price    18,949.10    €
    # CarConfig beenden
        Close CarConfig

iTB-TC-320-PC-389172
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Endpreis prüfen    Endpreis=15,000.00
        Verify Total Price    15,000.00    €
    # Endpreis prüfen    Endpreis=15,000.00
        Verify Total Price    15,000.00    €
    # CarConfig beenden
        Close CarConfig
