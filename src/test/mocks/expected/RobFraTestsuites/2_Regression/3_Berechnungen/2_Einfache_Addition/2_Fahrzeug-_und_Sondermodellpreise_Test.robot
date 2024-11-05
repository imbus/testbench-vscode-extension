*** Settings ***
Resource    ../../../../Resources/functional_keywords.resource
Metadata    UniqueID    itb-TC-19623
Metadata    Name    Fahrzeug- und Sondermodellpreise Test
Metadata    Numbering    1.2.3.2.2
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
itb-TC-19623-PC-119826
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
    # Endpreis prüfen    Endpreis=16,413.00
        Verify Total Price    16,413.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19623-PC-119825
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
    # Endpreis prüfen    Endpreis=16,049.00
        Verify Total Price    16,049.00    €
    # CarConfig beenden
        Close CarConfig

itb-TC-19623-PC-119824
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
    # Endpreis prüfen    Endpreis=17,499.99
        Verify Total Price    17,499.99    €
    # CarConfig beenden
        Close CarConfig
