import PropTypes from 'prop-types';
import React from 'react';

const PATHS = {
    'actor': 'M12 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6.5 20v-2.5A4.5 4.5 0 0 1 11 13h2a4.5 4.5 0 0 1 4.5 4.5V20',
    'arrow-left': 'M13.5 4.5 6 12l7.5 7.5M6.5 12H19',
    'arrow-right': 'm10.5 4.5 7.5 7.5-7.5 7.5M17.5 12H5',
    'book': 'M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z' +
        'M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z',
    'chevron-down': 'm5 9 7 7 7-7',
    'chevron-up': 'm5 15 7-7 7 7',
    'close': 'M5 5l14 14M19 5 5 19',
    'convert': 'M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3',
    'debug': 'M9 9h6m-7 4h8m-7 4h6M12 5V2m-7 9H2m20 0h-3M6 7 4 3m12-3-4 3M6 17l4-3m8 0 4 3' +
        'M7 12c0-4 2-7 5-7s5 3 5 7v3a5 5 0 0 1-10 0v-3Z',
    'extensions': 'M9.5 4H4v5.5a2.5 2.5 0 1 1 0 5V20h5.5a2.5 2.5 0 1 0 5 0H20v-5.5' +
        'a2.5 2.5 0 1 0 0-5V4h-5.5a2.5 2.5 0 1 0-5 0Z',
    'files': 'M4 5h6l2 2h8v12H4V5Zm0 4h16',
    'menu': 'M4 7h16M4 12h16M4 17h16',
    'minus': 'M5 12h14',
    'more': 'M6 12h.01M12 12h.01M18 12h.01',
    'plus': 'M12 5v14M5 12h14',
    'reset': 'M5.5 8.5A8 8 0 1 1 4 13M4 5v8h8',
    'search': 'm20 20-4.35-4.35M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
    'settings': 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5 1.1 2.2 2.4.4 1.8-1.6' +
        ' 2.2 2.2-1.6 1.8.4 2.4L20.5 13l-2.2 1.1-.4 2.4 1.6 1.8-2.2 2.2-1.8-1.6-2.4.4' +
        'L12 21.5l-1.1-2.2-2.4-.4-1.8 1.6-2.2-2.2 1.6-1.8-.4-2.4L3.5 13l2.2-1.1.4-2.4' +
        '-1.6-1.8 2.2-2.2 1.8 1.6 2.4-.4L12 3.5Z'
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
