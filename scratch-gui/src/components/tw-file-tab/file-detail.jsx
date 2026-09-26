import PropTypes from 'prop-types';
import React from 'react';
import classNames from 'classnames';

import BufferedInputHOC from '../forms/buffered-input-hoc.jsx';
import Input from '../forms/input.jsx';
import {getFileKind} from './file-kind.js';
import styles from './file-detail.css';

import modelIcon from './icon--model.svg';
import fileIcon from './icon--file.svg';

const BufferedInput = BufferedInputHOC(Input);

const TEXT_PREVIEW_BYTES = 20000;

/**
 * Plays audio and video through an object URL that lives as long as the file is shown.
 */
class MediaPreview extends React.Component {
    constructor (props) {
        super(props);
        this.url = URL.createObjectURL(new Blob([props.data], {type: props.mimeType}));
    }
    componentWillUnmount () {
        URL.revokeObjectURL(this.url);
    }
    render () {
        const Tag = this.props.kind === 'video' ? 'video' : 'audio';
        return (
            <Tag
                controls
                className={styles.media}
                src={this.url}
            />
        );
    }
}

MediaPreview.propTypes = {
    data: PropTypes.instanceOf(Uint8Array).isRequired,
    kind: PropTypes.oneOf(['audio', 'video']).isRequired,
    mimeType: PropTypes.string.isRequired
};

const Preview = ({file}) => {
    const kind = getFileKind(file.name);
    if (kind === 'image') {
        return (
            <img
                className={styles.image}
                draggable={false}
                src={file.thumbnail}
            />
        );
    }
    if (kind === 'audio' || kind === 'video') {
        return (
            <MediaPreview
                data={file.data}
                key={file.md5}
                kind={kind}
                mimeType={file.mimeType}
            />
        );
    }
    if (kind === 'text') {
        const text = new TextDecoder().decode(file.data.subarray(0, TEXT_PREVIEW_BYTES));
        return (
            <pre className={styles.text}>
                {text}
                {file.size > TEXT_PREVIEW_BYTES ? '\n…' : null}
            </pre>
        );
    }
    return (
        <div className={styles.placeholder}>
            <img
                className={styles.placeholderIcon}
                draggable={false}
                src={kind === 'model' ? modelIcon : fileIcon}
            />
            {kind === 'model' ? (
                <div>{'用 3D 擴充的「載入模型」積木載入這個檔案'}</div>
            ) : (
                <div>{'用「檔案」擴充的積木讀取這個檔案'}</div>
            )}
        </div>
    );
};

Preview.propTypes = {
    file: PropTypes.shape({
        name: PropTypes.string,
        data: PropTypes.instanceOf(Uint8Array),
        size: PropTypes.number,
        md5: PropTypes.string,
        mimeType: PropTypes.string,
        thumbnail: PropTypes.string
    }).isRequired
};

const FileDetail = props => {
    if (!props.file) {
        return (
            <div
                className={classNames(styles.empty, {[styles.dragging]: props.isDraggingOver})}
            >
                <div className={styles.emptyTitle}>{'這個專案還沒有檔案'}</div>
                <div>{'把檔案拖到這裡，或'}</div>
                <button
                    className={styles.button}
                    onClick={props.onUpload}
                >
                    {'上傳檔案'}
                </button>
                <div className={styles.hint}>
                    {'檔案會跟專案一起存進 .sb3，也會一起匯出成 HTML。'}
                </div>
            </div>
        );
    }

    const file = props.file;
    return (
        <div className={classNames(styles.detail, {[styles.dragging]: props.isDraggingOver})}>
            <div className={styles.header}>
                <BufferedInput
                    className={styles.nameInput}
                    tabIndex="1"
                    type="text"
                    value={file.name}
                    onSubmit={props.onRename}
                />
                <button
                    className={styles.button}
                    onClick={props.onDownload}
                >
                    {'下載'}
                </button>
                <button
                    className={classNames(styles.button, styles.danger)}
                    onClick={props.onDelete}
                >
                    {'刪除'}
                </button>
            </div>
            <div className={styles.info}>
                <span>{file.mimeType}</span>
                <span>{file.sizeText}</span>
            </div>
            <div className={styles.preview}>
                <Preview file={file} />
            </div>
        </div>
    );
};

FileDetail.propTypes = {
    file: PropTypes.shape({
        name: PropTypes.string,
        data: PropTypes.instanceOf(Uint8Array),
        size: PropTypes.number,
        md5: PropTypes.string,
        mimeType: PropTypes.string,
        sizeText: PropTypes.string,
        thumbnail: PropTypes.string
    }),
    isDraggingOver: PropTypes.bool,
    onDelete: PropTypes.func.isRequired,
    onDownload: PropTypes.func.isRequired,
    onRename: PropTypes.func.isRequired,
    onUpload: PropTypes.func.isRequired
};

export default FileDetail;
