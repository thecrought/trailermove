// ==UserScript==
// @name         Trailer move restriction
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Restrict bays, change Save button color, and update text based on restrictions
// @author       Valdemar Iliev (valdemai)
// @match        https://trans-logistics-eu.amazon.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/thecrought/trailermove/refs/heads/main/Trailer%20restriction.user.js
// @updateURL    https://raw.githubusercontent.com/thecrought/trailermove/refs/heads/main/Trailer%20restriction.user.js
// ==/UserScript==

(function () {
    'use strict';

    console.log('Tampermonkey script initialized for trailer movement restrictions.');

    // Function to create the credits div
    function createCreditsDiv() {
        const creditsDiv = document.createElement('div');
        creditsDiv.innerHTML = 'Improved YMS Script by <span style="font-weight: bold;"><a href="https://fclm-portal.amazon.com/employee/timeDetails?warehouseId=LCY2&employeeId=102679647" style="color: black; text-decoration: underline; font-weight: bold;">Valdemar Iliev (valdemai) v0.0.7</a></span>';
        creditsDiv.style.display = 'inline-block';
        creditsDiv.style.marginLeft = '10px';
        creditsDiv.style.color = 'black';
        creditsDiv.style.fontSize = '12px';
        creditsDiv.style.padding = '2px 5px';
        creditsDiv.style.borderRadius = '3px';
        creditsDiv.style.opacity = '0.9';
        creditsDiv.id = 'custom-credits-div'; // Unique ID to prevent duplicates
        return creditsDiv;
    }

    // Function to inject or re-inject credits
    function injectCredits() {
        if (window.location.href !== "https://trans-logistics-eu.amazon.com/yms/shipclerk/#/yard") {
            console.log('Script not executed: URL does not match.');
            return;
        }

        const titleHeader = document.querySelector('h1#title');
        if (!titleHeader) {
            console.log('h1#title not found yet.');
            return;
        }

        const yardManagementTag = titleHeader.querySelector('t');
        if (!yardManagementTag) {
            console.log('<t> tag not found inside h1#title yet.');
            return;
        }

        // Check if credits already exist to avoid duplicates
        if (!yardManagementTag.querySelector('#custom-credits-div')) {
            const creditsDiv = createCreditsDiv();
            yardManagementTag.appendChild(creditsDiv);
            console.log('Credits successfully added or re-added inside <t> tag within h1#title.');
        }
    }

    // Initial attempt to add credits
    injectCredits();

    // Use MutationObserver to monitor changes to h1#title
    const observer = new MutationObserver(() => {
        injectCredits(); // Re-inject credits if <t> changes or reappears
    });

    // Start observing the body, but we'll narrow it to h1#title once found
    const startObserving = () => {
        const titleHeader = document.querySelector('h1#title');
        if (titleHeader) {
            observer.observe(titleHeader, {
                childList: true,
                subtree: true
            });
            console.log('MutationObserver started watching h1#title.');
        } else {
            setTimeout(startObserving, 500); // Retry until h1#title is found
        }
    };
    startObserving();

    // Define restricted bays and handle button restrictions
    const restrictedBays = ['IB14-SD', 'IB19-SD', 'IB20-SD', 'IB21-SD', 'IB22-SD'];

    document.body.addEventListener('click', function (event) {
        if (event.target && event.target.matches('.request-movement.highlight')) {
            console.log('Button clicked. Waiting for the pop-up...');
            const checkInterval = setInterval(() => {
                console.log('Checking for pop-up content...');
                const destinationField = document.querySelector('select[ng-model="destination"]');
                const saveButton = Array.from(document.querySelectorAll('button'))
                    .find(button => button.innerText.trim() === 'Save');
                if (destinationField && saveButton) {
                    console.log('Dropdown and Save button found. Setting up restrictions.');
                    clearInterval(checkInterval);
                    destinationField.addEventListener('change', function () {
                        const selectedOption = destinationField.options[destinationField.selectedIndex];
                        const selectedValue = selectedOption ? selectedOption.textContent.trim() : '';
                        console.log('Dropdown value changed:', selectedValue);
                        const doubleDeckerText = Array.from(document.querySelectorAll('*'))
                            .find(el => el.textContent && el.textContent.includes('Double Decker Trailer'));
                        console.log('Double Decker Trailer text found:', !!doubleDeckerText);
                        if (doubleDeckerText) {
                            if (restrictedBays.includes(selectedValue)) {
                                console.log(`Restricted bay selected: ${selectedValue}. Disabling and updating Save button.`);
                                saveButton.disabled = true;
                                saveButton.style.backgroundColor = 'red';
                                saveButton.style.color = 'white';
                                saveButton.innerText = 'DO NOT MOVE';
                            } else {
                                console.log(`Valid bay selected: ${selectedValue}. Enabling Save button and restoring styles.`);
                                saveButton.disabled = false;
                                saveButton.style.backgroundColor = '';
                                saveButton.style.color = '';
                                saveButton.innerText = 'Save';
                            }
                        }
                    });
                } else {
                    console.log('Dropdown or Save button not found. Retrying...');
                }
            }, 700); // Check every 700ms
        }
    });
})();
