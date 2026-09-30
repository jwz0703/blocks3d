import bindAll from 'lodash.bindall';
import PropTypes from 'prop-types';
import React from 'react';
import {injectIntl, intlShape, defineMessages} from 'react-intl';
import JSZip from '@turbowarp/jszip';
import VM from 'scratch-vm';

import {getSpriteLibrary} from '../lib/libraries/tw-async-libraries';
import randomizeSpritePosition from '../lib/randomize-sprite-position';
import spriteTags from '../lib/libraries/sprite-tags';

import LibraryComponent from '../components/library/library.jsx';
import builtinComponents from '../lib/libraries/tw-builtin-components.json';

const messages = defineMessages({
    libraryTitle: {
        defaultMessage: 'Choose a Sprite',
        description: 'Heading for the sprite library',
        id: 'gui.spriteLibrary.chooseASprite'
    }
});

/**
 * The components that come with the editor go first (ROADMAP.md 階段 10): items with the .3dsc file inside.
 * @param {Array<object>} sprites the sprites of the library
 * @returns {Array<object>} components, then sprites
 */
const withComponents = sprites => {
    const components = builtinComponents.map(item => {
        // The picture of the component with the values it starts with
        const svg = item.thumbnail || Object.values(item.files)[0] || '';
        return {
            name: item.name,
            tags: item.tags,
            rawURL: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`,
            twComponent: item
        };
    });
    return components.concat(sprites);
};

class SpriteLibrary extends React.PureComponent {
    constructor (props) {
        super(props);
        bindAll(this, [
            'handleComponentSelect',
            'handleItemSelect'
        ]);
        this.state = {
            data: getSpriteLibrary()
        };
    }
    componentDidMount () {
        if (this.state.data.then) {
            this.state.data.then(data => this.setState({
                data
            }));
        }
    }
    async handleComponentSelect (item) {
        const zip = new JSZip();
        zip.file('component.json', JSON.stringify(item.twComponent.component));
        for (const [name, text] of Object.entries(item.twComponent.files)) zip.file(name, text);
        const bytes = await zip.generateAsync({type: 'uint8array'});
        await this.props.vm.importComponent(bytes);
        this.props.onActivateBlocksTab();
    }
    handleItemSelect (item) {
        if (item.twComponent) {
            this.handleComponentSelect(item);
            return;
        }
        // Randomize position of library sprite
        randomizeSpritePosition(item);
        this.props.vm.addSprite(JSON.stringify(item)).then(() => {
            this.props.onActivateBlocksTab();
        });
    }
    render () {
        return (
            <LibraryComponent
                data={this.state.data.then ? null : withComponents(this.state.data)}
                id="spriteLibrary"
                tags={spriteTags}
                title={this.props.intl.formatMessage(messages.libraryTitle)}
                removedTrademarks
                onItemSelected={this.handleItemSelect}
                onRequestClose={this.props.onRequestClose}
            />
        );
    }
}

SpriteLibrary.propTypes = {
    intl: intlShape.isRequired,
    onActivateBlocksTab: PropTypes.func.isRequired,
    onRequestClose: PropTypes.func,
    vm: PropTypes.instanceOf(VM).isRequired
};

export default injectIntl(SpriteLibrary);
