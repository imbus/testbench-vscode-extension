*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    itb-TC-19628
Metadata    Name    Rücksetzen nach Konfig
Metadata    Numbering    1.2.2.3.1
Test Tags    Demo    Systemtest


*** Test Cases ***
itb-TC-19628-PC-120085
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Rolo
        Select Base Model    Rolo
    # Sondermodell wählen    Sondermodell=Keine
        Select Special Model    Keine
    # Endpreis prüfen    Endpreis=12,300.00
        Verify Total Price    12,300.00    €
    # Fahrzeug wählen    Fahrzeug=Minigolf
        Select Base Model    Minigolf
    # Sondermodell wählen    Sondermodell=Jazz
        Select Special Model    Jazz
    # Zubehör wählen    Zubehör(Liste)=Lederlenkrad
        Select Accessory    Lederlenkrad
    # Zubehör wählen    Zubehör(Liste)=Beheizbarer Außenspiegel
        Select Accessory    Beheizbarer Außenspiegel
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    # Endpreis prüfen    Endpreis=17,819.00
        Verify Total Price    17,819.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19628-PC-120096
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn
    # Neues Fahrzeug erstellen
        Click New_Car
    # Fahrzeug wählen    Fahrzeug=Rassant Family
        Select Base Model    Rassant Family
    # Sondermodell wählen    Sondermodell=Luxus
        Select Special Model    Luxus
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
    # Endpreis prüfen    Endpreis=24,949.09
        Verify Total Price    24,949.09    €
    # Fahrzeug wählen    Fahrzeug=Rolo
        Select Base Model    Rolo
    # Sondermodell wählen    Sondermodell=Keine
        Select Special Model    Keine
    # Endpreis prüfen    Endpreis=12,300.00
        Verify Total Price    12,300.00    €
    # CarConfig beenden
        Close CarConfig
