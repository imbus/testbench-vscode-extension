*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    itb-TC-19619
Metadata    Name    Sondermodell wählen alle
Metadata    Numbering    1.2.2.2.1
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
itb-TC-19619-PC-119581
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
    # Sondermodell wählen    Sondermodell=Jazz
        Select Special Model    Jazz
    # Sondermodell wählen    Sondermodell=Luxus
        Select Special Model    Luxus
    # CarConfig beenden
        Close CarConfig
