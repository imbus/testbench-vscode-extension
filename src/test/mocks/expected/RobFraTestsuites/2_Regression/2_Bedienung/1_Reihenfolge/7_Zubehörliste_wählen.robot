*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    itb-TC-19617
Metadata    Name    Zubehörliste wählen
Metadata    Numbering    1.2.2.1.7
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
itb-TC-19617-PC-119491
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    [Setup]    Setup-itb-TC-19617-PC-119491
    # Neues Fahrzeug erstellen
        Click New_Car
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
    [Teardown]    Teardown-itb-TC-19617-PC-119491

itb-TC-19617-PC-188585
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    [Setup]    Setup-itb-TC-19617-PC-188585
    # Neues Fahrzeug erstellen
        Click New_Car
    # Zubehör wählen    Zubehör(Liste)=Sportfelgen
        Select Accessory    Sportfelgen
    # Zubehör wählen    Zubehör(Liste)=ABS
        Select Accessory    ABS
    [Teardown]    Teardown-itb-TC-19617-PC-188585

itb-TC-19617-PC-188587
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    [Setup]    Setup-itb-TC-19617-PC-188587
    # Neues Fahrzeug erstellen
        Click New_Car
    # Zubehör wählen    Zubehör(Liste)=Lederlenkrad
        Select Accessory    Lederlenkrad
    # Zubehör wählen    Zubehör(Liste)=Beheizbarer Außenspiegel
        Select Accessory    Beheizbarer Außenspiegel
    # Zubehör wählen    Zubehör(Liste)=Zentralverriegelung
        Select Accessory    Zentralverriegelung
    [Teardown]    Teardown-itb-TC-19617-PC-188587

itb-TC-19617-PC-188589
    [Tags]    Demo    Systemtest    Testumgebung:HIL 1
    [Setup]    Setup-itb-TC-19617-PC-188589
    # Neues Fahrzeug erstellen
        Click New_Car
    [Teardown]    Teardown-itb-TC-19617-PC-188589


*** Keywords ***
Setup-itb-TC-19617-PC-119491
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn

Setup-itb-TC-19617-PC-188585
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn

Setup-itb-TC-19617-PC-188587
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn

Setup-itb-TC-19617-PC-188589
    # CarConfig starten
        Open CarConfig
        Set Username    schulung20
        Set Password    @RBTFRMWRK@
        Click Login Btn

Teardown-itb-TC-19617-PC-119491
    # CarConfig beenden
        Close CarConfig

Teardown-itb-TC-19617-PC-188585
    # CarConfig beenden
        Close CarConfig

Teardown-itb-TC-19617-PC-188587
    # CarConfig beenden
        Close CarConfig

Teardown-itb-TC-19617-PC-188589
    # CarConfig beenden
        Close CarConfig

