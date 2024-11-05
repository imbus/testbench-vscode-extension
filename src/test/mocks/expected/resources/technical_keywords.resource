*** Settings ***
Library           Browser    timeout=10s    run_on_failure=Embed_Screenshot

*** Keywords ***
Embed_Screenshot
    Take Screenshot    EMBED    fullPage=True

Log Starttime
    Set Suite Variable    \${starttime}    ${{time.time()}}

Log Endtime
    ${duration}=    Evaluate    '\\033[4m\\033[94m' + "Testtime: " + str(round(time.time() - $starttime, 3)) + "\\033[0m"
    #Log To Console    ${duration}

Get Options as Index
    [Documentation]    Returns the index of cars base model name.
    @{options}=    Get Elements    css=div.displayFlexStyleRow select option
    &{Option_dict}=    Create Dictionary
    FOR    ${index}    ${option}    IN ENUMERATE    @{options}
        ${Text}    Get Text    ${option}
        ${index}    Convert To String    ${index}
        &{Option_dict}    Create Dictionary    &{Option_dict}    ${Text}=${index}
    END
    [Return]    ${Option_dict}

Get Options as Values
    @{options}=    Get Elements    css=div.displayFlexStyleRow select option
    &{Option_dict}=    Create Dictionary
    FOR    ${option}    IN    @{options}
        ${Text}=    Get Text    ${option}
        ${Value}=
        ...    Get Attribute
        ...    ${option}    value
        &{Option_dict}=    Create Dictionary    &{Option_dict}    ${Text}=${Value}
    END
    [Return]    ${Option_dict}

Get Element By Text
    [Arguments]    ${locator}    ${text}
    @{elements}    Get Elements    ${locator}
    FOR    ${element}    IN    @{elements}
        ${act_text}=    Get Text    ${element}
        Return From Keyword If    $act_text == $text    ${element}
    END

