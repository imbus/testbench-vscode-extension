*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    itb-TC-19616
Metadata    Name    Sondermodell wählen
Metadata    Numbering    1.2.2.2.2
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
itb-TC-19616-PC-119480
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
    # CarConfig beenden
        Close CarConfig

itb-TC-19616-PC-119546
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
    # CarConfig beenden
        Close CarConfig

itb-TC-19616-PC-119557
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
    # CarConfig beenden
        Close CarConfig
