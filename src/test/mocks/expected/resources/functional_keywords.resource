*** Settings ***
Resource          ./technical_keywords.resource


*** Variables ***
${BASE-URL}= 	http://car.keyword-driven.de
${select_CarBaseModel}=    "Basismodell" >> ../.. >> select
${txt_CarName}=    "Speichern:" >> ../.. >> input
${btn_NewCar}=    a.HomeListButtonNewCar
${btn_LeftArrow}=    i.fa-chevron-left
${btn_RightArrow}=    i.fa-chevron-right
${btn_Save}=      a >> "Speichern"
${HEADLESS}=    False
${BROWSER}=    chromium

*** Keywords ***
Choose File
    [Documentation]     Inputs the ``file with absolut path`` into the ``input field locator``. Depends on INPUT - element on current page with "type = 'file'" (e.g. <input type="file" accept=".json" title>)
    [Arguments]     ${file_with_absolute_path}     ${locator}=//input[@type='file']
    Log     Keyword Call
    Log Many     ${file_with_absolute_path}     ${locator}

Verify Base Mode Page
    Get Url    ==    ${BASE-URL}/config/basemodel

Verify Login
    Wait For Navigation     ${BASE-URL}/list    5 sec
    Get Url    ==    ${BASE-URL}/list

Select Base Model
    [Arguments]    ${basemodel}
    Click    css=[href="/config/basemodel"]
    Wait For Elements State    ${select_CarBaseModel}
    Select Options By    ${select_CarBaseModel}    text    ${basemodel}

Select Special Model
    [Arguments]    ${special}
    Click    css=[href="/config/edition"] >> "Edition"
    Click    //div[@id='editionNames']//div[contains(text(),'${special}')]

Select Accessories
    [Arguments]    @{accessory_list}
    Go To Accessories
    FOR    ${acc}    IN    @{accessory_list}
        Select Accessory    ${acc}
    END

Select Accessory
    [Arguments]    ${accessory}
    Go To Accessories
    Check Checkbox    //span[contains(text(),'${accessory}')]/../input

Unselect Accessory
    [Arguments]    ${accessory}
    Go To Accessories
    Uncheck Checkbox    //span[contains(text(),'${accessory}')]/../input

Set Car Name
    [Arguments]    ${Name}
    Click    [href="/config/summary"] >> "Zusammenfassung"
    Type Text    ${txt_CarName}    ${Name}

Verify Total Price
    [Arguments]    ${expected_price}    ${unit}
    Click    [href="/config/summary"] >> "Zusammenfassung"
    Get Text    css=span.summaryTotalPriceStyle > h6    validate    re.match(f".*: {re.escape('${expected_price}')} +{re.escape('${unit}')}\S*", value)


Verify Price
    [Arguments]    ${expected_price}
    ${price_text}=    Get Text    css=span.summaryTotalPriceStyle
    Should Contain    ${price_text}    ${expected_price}

Verify Accessory
    [Arguments]    ${accessory}    ${price}
    Get Text    .extraEquipmentListStyle >> text=${accessory} >> .. >> .flexGrowSmall    ==    ${price}

Open CarConfig As User
    Open CarConfig
    Login User    admin    @RBTFRMWRK@

Open CarConfig
    ${ids}=    Get Browser Ids
    IF    len($ids) == 0
        New Browser    browser=${BROWSER}    headless=${HEADLESS}
    END
    New Context
    New Page    ${BASE-URL}

Close CarConfig
    Close Context    ALL    ALL

Login User
    [Arguments]     ${user}   ${pw}
    Set Username    ${user}
    Set Password    ${$pw}
    Click Login Btn

Go To Next Page
    Click    ${btn_RightArrow}

Go To Prev Page
    Click    ${btn_LeftArrow}

Go To Accessories
    ${location}    Get Url
    IF    $location != '${BASE-URL}/config/extras'    Click    css=[href="/config/extras"] >> nth=0

Click New_Car
    Wait For Elements State    ${btn_NewCar}    visible
    Click    ${btn_NewCar}

Save New_Car
    Click    ${btn_Save}

Set Username
    [Arguments]    ${user}
    Fill Text    id=input_username    ${user}

Set Password
    [Arguments]    ${password}
    Fill Secret    id=input_password    $password

Click Login Btn
    Click    id=button_login

