import PropTypes from 'prop-types';
import React from 'react';

const PATHS = {
    'arrow-left': 'M13.5 4.5 6 12l7.5 7.5M6.5 12H19',
    'arrow-right': 'm10.5 4.5 7.5 7.5-7.5 7.5M17.5 12H5',
    'chevron-down': 'm5 9 7 7 7-7',
    'chevron-up': 'm5 15 7-7 7 7',
    close: 'M5 5l14 14M19 5 5 19',
    menu: 'M4 7h16M4 12h16M4 17h16',
    minus: 'M5 12h14',
    plus: 'M12 5v14M5 12h14',
    reset: 'M5.5 8.5A8 8 0 1 1 4 13M4 5v8h8'
};

const InterfaceIcon = ({name}) => (
    <svg
        aria-hidden="true"
        fill="none"
        height="16"
        viewBox="0 0 24 24"
        width="16"
    >
        <path
            d={PATHS[name]}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
        />
    </svg>
);

InterfaceIcon.propTypes = {
    name: PropTypes.oneOf(Object.keys(PATHS)).isRequired
};

export default InterfaceIcon;
