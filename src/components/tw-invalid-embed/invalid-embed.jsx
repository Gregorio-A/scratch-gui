import React from 'react';
import styles from './invalid-embed.css';
import {
    APP_NAME,
    DOCUMENTATION_URL,
    EDITOR_URL,
    SUPPORT_URL
} from '../../lib/brand';

// Note that when this component is used, the rest of scratch-gui is not being run, so don't
// use redux, themes, translations, etc.

// We also can't be certain that the iframe sandbox will let us open up links, so make sure
// all the links can be manually visited if necessary.

const InvalidEmbed = () => (
    <div className={styles.container}>
        <h1>{`Invalid ${APP_NAME} Embed :(`}</h1>
        <p>
            {'See '}
            <a
                href={`${DOCUMENTATION_URL}#embedding`}
                target="_blank"
                rel="noreferrer"
            >
                {`${DOCUMENTATION_URL}#embedding`}
            </a>
            {/* eslint-disable-next-line max-len */}
            {' for more information. You need to replace the iframe src with the embed page:'}
        </p>
        <p className={styles.code}>
            {`${EDITOR_URL}<project ID>/embed`}
        </p>
        <p>
            {'Here\'s an example of a full iframe to embed a project:'}
        </p>
        <p className={styles.code}>
            {/* eslint-disable-next-line max-len */}
            {`<iframe src="${EDITOR_URL}60917032/embed" width="482" height="412" allowtransparency="true" frameborder="0" scrolling="no" allowfullscreen></iframe>`}
        </p>
        <p>
            {'If you are seeing this page even though you aren\'t embedding anything, let us know on '}
            <a
                href={SUPPORT_URL}
                target="_blank"
                rel="noreferrer"
            >
                {SUPPORT_URL}
            </a>
            {'.'}
        </p>
    </div>
);

export default InvalidEmbed;
