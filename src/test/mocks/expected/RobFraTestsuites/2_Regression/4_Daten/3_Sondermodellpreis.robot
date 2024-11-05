*** Settings ***
Resource    ../../../Resources/functional_keywords.resource
Metadata    UniqueID    iTB-TC-319
Metadata    Name    Sondermodellpreis
Metadata    Numbering    1.2.4.3
Test Tags    Demo    Systemtest    Automatisiert


*** Test Cases ***
iTB-TC-319-PC-1619
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

iTB-TC-319-PC-1620
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

iTB-TC-319-PC-1621
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
