import classNames from 'classnames';
import PropTypes from 'prop-types';
import React from 'react';

import Box from '../box/box.jsx';
import Modal from '../../containers/modal.jsx';

import {looksLikePanorama} from '../../lib/tw-sky-backdrop';

import styles from './backdrop-kind-modal.css';

const KINDS = [
    {
        kind: '2d',
        name: '2D 背景',
        description: '圖畫在 3D 場景後面，可以用繪圖編輯器修改'
    },
    {
        kind: 'hdri',
        name: 'HDRI 天空',
        description: '360° 全景圖包住整個場景，也用來照明；圖片會存進檔案分頁'
    }
];

/**
 * Asks whether uploaded images are 2D backdrops or HDRI skies.
 * @param {object} props component props
 * @returns {React.ReactElement} the modal
 */
const BackdropKindModal = ({fileNames, suggested, onChoose, onClose}) => (
    <Modal
        className={styles.modalContent}
        contentLabel={fileNames.length > 1 ? '這些圖要當作…' : '這張圖要當作…'}
        id="backdropKindModal"
        onRequestClose={onClose}
    >
        <Box className={styles.body}>
            <p className={styles.files}>{fileNames.join('、')}</p>
            <div className={styles.choices}>
                {KINDS.map(({kind, name, description}) => (
                    <button
                        key={kind}
                        className={classNames(styles.choice, {[styles.suggested]: kind === suggested})}
                        onClick={() => onChoose(kind)} // eslint-disable-line react/jsx-no-bind
                    >
                        <span className={styles.choiceName}>{name}</span>
                        <span className={styles.choiceDescription}>{description}</span>
                        {kind === suggested ? (
                            <span className={styles.suggestion}>{'寬高比 2:1，看起來是全景圖'}</span>
                        ) : null}
                    </button>
                ))}
            </div>
        </Box>
    </Modal>
);

BackdropKindModal.propTypes = {
    fileNames: PropTypes.arrayOf(PropTypes.string).isRequired,
    suggested: PropTypes.oneOf(['2d', 'hdri']),
    onChoose: PropTypes.func.isRequired,
    onClose: PropTypes.func.isRequired
};

/**
 * Ask a component's user whether images are 2D backdrops or HDRI skies. The component keeps the question in
 * state.backdropKindPrompt and renders it with renderBackdropKindModal.
 * @param {React.Component} component the component
 * @param {File[]} files the images
 * @returns {Promise<?string>} '2d', 'hdri', or null if the modal was closed
 */
const askBackdropKind = async (component, files) => {
    const panorama = await looksLikePanorama(files[0]);
    return new Promise(resolve => {
        component.setState({
            backdropKindPrompt: {
                fileNames: files.map(file => file.name),
                suggested: panorama ? 'hdri' : null,
                resolve: kind => {
                    component.setState({backdropKindPrompt: null});
                    resolve(kind);
                }
            }
        });
    });
};

/**
 * @param {React.Component} component a component that asks with askBackdropKind
 * @returns {?React.ReactElement} the modal while it asks
 */
const renderBackdropKindModal = component => {
    const prompt = component.state.backdropKindPrompt;
    if (!prompt) return null;
    const handleChoose = prompt.resolve;
    return (
        <BackdropKindModal
            fileNames={prompt.fileNames}
            suggested={prompt.suggested}
            onChoose={handleChoose}
            onClose={() => prompt.resolve(null)} // eslint-disable-line react/jsx-no-bind
        />
    );
};

export {
    BackdropKindModal as default,
    askBackdropKind,
    renderBackdropKindModal
};
