import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {defineMessages, injectIntl, intlShape} from 'react-intl';
import VM from 'scratch-vm';

import {getBackdropLibrary} from '../lib/libraries/tw-async-libraries';
import backdropTags from '../lib/libraries/backdrop-tags';
import LibraryComponent from '../components/library/library.jsx';
import getEnvironmentPreview from '../lib/tw-environment-preview';
import {addSkyBackdrop, pickFiles} from '../lib/tw-sky-backdrop';
import {defaultSkyEnvironment} from 'scratch-vm/src/engine/scene-3d-environment';
import {SKY_PACKS} from 'scratch-vm/src/engine/scene-3d-sky-packs';

// Images that can be HDRI skies
const SKY_FILE_ACCEPT = '.hdr,.exr,.png,.jpg,.jpeg,.webp';

/**
 * @param {VM} vm the VM, for the previews
 * @returns {object[]} library items of the backdrop packs (3D skies), which go before the 2D backdrops
 */
const getSkyPackItems = vm => SKY_PACKS.map(pack => ({
    name: pack.name,
    description: pack.description,
    rawURL: getEnvironmentPreview(defaultSkyEnvironment(pack.id), vm),
    tags: ['3d'],
    skyPack: pack.id
}));

const messages = defineMessages({
    libraryTitle: {
        defaultMessage: 'Choose a Backdrop',
        description: 'Heading for the backdrop library',
        id: 'gui.costumeLibrary.chooseABackdrop'
    }
});


class BackdropLibrary extends React.Component {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleItemSelect'
        ]);
        const data = getBackdropLibrary();
        this.state = {
            data: data.then ? data : this.withSkyPacks(data)
        };
    }
    componentDidMount () {
        if (this.state.data.then) {
            this.state.data.then(data => this.setState({
                data: this.withSkyPacks(data)
            }));
        }
    }
    /**
     * @param {object[]} backdrops the 2D backdrops of the library
     * @returns {Array} the backdrop packs, then the 2D backdrops
     */
    withSkyPacks (backdrops) {
        return [...getSkyPackItems(this.props.vm), '---', ...backdrops];
    }
    async addSkyBackdrop (type) {
        const vm = this.props.vm;
        // An HDRI sky needs a picture: open the file picker right away, while the click still allows it. Without a
        // picture, the Environment tab can pick one later.
        const picking = type === 'hdri' ? pickFiles(SKY_FILE_ACCEPT) : null;
        await addSkyBackdrop(vm, type);
        if (!picking) return;
        const index = vm.runtime.getTargetForStage().getCostumes().length - 1;
        const [file] = await picking;
        if (!file) return;
        const fileName = vm.runtime.fileManager.addFile(file.name, await file.arrayBuffer());
        vm.setEnvironment3D({sky: {file: fileName}}, index);
    }
    handleItemSelect (item) {
        if (item.skyPack) {
            this.addSkyBackdrop(item.skyPack);
            return;
        }
        const vmBackdrop = {
            name: item.name,
            rotationCenterX: item.rotationCenterX,
            rotationCenterY: item.rotationCenterY,
            bitmapResolution: item.bitmapResolution,
            skinId: null
        };
        // Do not switch to stage, just add the backdrop
        this.props.vm.addBackdrop(item.md5ext, vmBackdrop);
    }
    render () {
        return (
            <LibraryComponent
                data={this.state.data.then ? null : this.state.data}
                id="backdropLibrary"
                tags={backdropTags}
                title={this.props.intl.formatMessage(messages.libraryTitle)}
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

BackdropLibrary.propTypes = {
    intl: intlShape.isRequired,
    onRequestClose: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(BackdropLibrary);
