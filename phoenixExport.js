/**
 * javascript code to export a ROOT geometry to GLTF
 *
 * Main supported features :
 *   - able to cleanup the geometry by dropping all subtrees of a given list
 *   - able to split the geometry into pieces and match them to the hierarchical menu in phoenix
 *   - supports default opacity and visibility for each piece
 *   - simplifies the geometry for spheres and cones to avoid too many faces
 *   - deduplicate materials in the resulting gltf file
 */

/// checks whether a name matches one of the given paths
function startsWith(name, paths) {
    for (const path of paths) {
        if (name.startsWith(path)) {
            return true;
        }
    }
    return false;
}

/// filters an array in place
function filterArrayInPlace(a, condition, thisArg) {
    var j = 0;
    a.forEach((e, i) => { 
        if (condition.call(thisArg, e, i, a)) {
            if (i!==j) a[j] = e; 
            j++;
        }
    });
    a.length = j;
    return a;
}

/**
 * cleans up the geometry in node by dropping all subtress whose path starts with
 * one of the hidden_paths and all nodes byond a given level
 */
function cleanup_geometry(node, hidden_paths, max_level=999, level = 0) {
    if (node.fVolume.fNodes) {
        // drop hidden nodes, and everything after level 4
        filterArrayInPlace(node.fVolume.fNodes.arr, n=>level<max_level&&!startsWith(n.fName, hidden_paths));
        // recurse to children
        for (const snode of node.fVolume.fNodes.arr) {
            cleanup_geometry(snode, hidden_paths, max_level, level + 1);
        }
    }
}

/// deduplicates identical materials in the given gltf file
function deduplicate(gltf) {
    // deduplicate materials
    // scan them, build table of correspondance
    var kept = []
    var links = {}
    var materials = gltf["materials"];
    for (var index = 0; index < materials.length; index++) {
        var found = false;
        for (var kindex = 0; kindex < kept.length; kindex++) {
            if (JSON.stringify(kept[kindex]) == JSON.stringify(materials[index])) {
                links[index] = kindex;
                found = true;
                break;
            }
        }
        if (!found) {
            links[index] = kept.langth;
            kept.push(materials[index]);
        }
    }
    // now rewrite the materials table and fix the meshes
    gltf["materials"] = kept;
    for (const mesh of gltf["meshes"]) {
        for(const primitive of mesh["primitives"]) {
            if ("material" in primitive) {
                primitive["material"] = links[primitive["material"]];
            }
        }
    }
}

/// convert given geometry to GLTF
function convert_geometry(obj3d, name, binary) {
    var exporter = new THREE.GLTFExporter;
    exporter.parse(obj3d, function(gltf) {
        if (binary) {
            saveAs(fileToSave, name);
        } else {
            // json output
            deduplicate(gltf);
            var fileToSave = new Blob([JSON.stringify(gltf)], {
                type: 'application/json',
                name: name
            });
            saveAs(fileToSave, name);
        }
    }, function(){}, {'binary':binary})
}

var kVisThis = 0x80;
var kVisDaughter = 0x8;

// goes recursively through shape and sets the number of segments for spheres
function fixSphereShapes(shape) {
    // in case of sphere, do the fix
    if (shape._typename == "TGeoSphere") {
        shape.fNseg = 3;
        shape.fNz = 3;
    }
    // in case of composite shape, recurse
    if (shape._typename == "TGeoCompositeShape") {
        fixSphereShapes(shape.fNode.fLeft)
        fixSphereShapes(shape.fNode.fRight)
    }
}

// makes given node visible
function setVisible(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt | kVisThis);
    // Change the number of faces for sphere so that we avoid having
    // megabytes for the Rich mirrors, which are actually almost flat
    // Default was 20 and 11
    fixSphereShapes(node.fVolume.fShape)
}
// makes given node's daughters visible
function setVisibleDaughter(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt | kVisDaughter);
}
// makes given node invisible
function setInvisible(node) {
    node.fVolume.fGeoAtt = (node.fVolume.fGeoAtt & ~kVisThis);
}
// makes given node and all its children recursively visible
function set_visible_recursively(node) {
    setVisible(node);
    if (node.fVolume.fNodes) {
        for (var j = 0; j < node.fVolume.fNodes.arr.length; j++) {
            var snode = node.fVolume.fNodes.arr[j];
            set_visible_recursively(snode);
        }
    }
}

/**
 * make only the given paths visible in a geometry and returns
 * whether anything at all is visible
 */
function keep_only_subpart(volume, paths) {
    if (!volume.fNodes) return false;
    var anyfound = false;
    for (var j = 0; j < volume.fNodes.arr.length; j++) {
        var snode = volume.fNodes.arr[j];
        if (startsWith(snode.fName, paths)) {
            // need to be resursive in case something deeper was hidden in previous round
            set_visible_recursively(snode);
            anyfound=true;
        } else {
            setInvisible(snode);
            // only hide if no subpart is shown
            var subpartfound = keep_only_subpart(snode.fVolume, paths);
            if (subpartfound) {
                setVisibleDaughter(snode);
                anyfound = true;
            }
        }
    }
    return anyfound;
}

/**
 * Convert a given geometry to the gltf file
 * @parameter obj the input geometry
 * @parameter filename the name of the resulting file
 * @parameter max_level maximum depth to convert. Anything below will be discarded
 * @parameter hide_children array of paths prefix for nodes that should be ignored
 * @parameter subparts definition of the subparts to create in the geometry
 * 
 * subparts is a dictionnary with
 *   - key being the path of the subpart in the phoenix menu, with ' > ' as separator
 *     for the different levels, e.g. "a > b > c" will be entry c in submenu b of menu a
 *   - value being an array of 2 items :
 *      + an array of paths to consider for thea part
 *      + a boolean or a float between 0 and 1 defining the default visibility of the part
 *        false means not visible, true means visible, float means visible with that opacity
 */
async function internal_convert_geometry(obj, filename, max_level, subparts, hide_children) {
    var scenes = [];
    // for each geometry subpart, duplicate the geometry and keep only the subpart
    for (const [name, entry] of Object.entries(subparts)) {
        console.log('Generating ' + name);
        // drop nodes we do not want to see at all (usually too detailed parts)
        cleanup_geometry(obj.fNodes.arr[0], hide_children, max_level);
        // dump to gltf, using one scene per subpart
        var promise = JSROOT.require('geom').then(geo => {
            // set nb of degrees per face for circles approximation (default 6)
            // here 15 means circles are polygones with 24 faces (default 60)
            geo.geoCfg('GradPerSegm', 15);
            const paths = entry[0];
            const visibility = entry[1];
            // extract subpart of ROOT geometry
            setVisible(obj.fNodes.arr[0]);
            keep_only_subpart(obj.fMasterVolume, paths);
            // convert to gltf
            var scene = new THREE.Scene();
            scene.name = name;
            var children = geo.build(obj, {dflt_colors: true, vislevel:10, numfaces: 10000000, numnodes: 500000});
            scene.children.push( children );
            if (typeof visibility == "boolean") {
                scene.userData = {"visible" : visibility};
            } else {
                scene.userData = {"visible" : true, "opacity" : visibility};
            }
            scenes.push(scene);
        });
        await promise;
    }
    console.log(scenes.length + ' scenes generated');
    convert_geometry(scenes, filename, false); // not using binary format
}
   
function convertGeometry(inputFile, outputFile, max_level, subparts, hide_children, objectName = "Default") {
    var msg = "Converting ROOT geometry from " + inputFile + " to GLTF format in " + outputFile + "...</br>";
    document.getElementsByTagName("body")[0].innerHTML = msg;
    JSROOT.openFile(inputFile)
        .then(file => file.readObject(objectName + ";1"))
        .then(obj => internal_convert_geometry(obj, outputFile, max_level, subparts, hide_children));
    document.getElementsByTagName("body")[0].innerHTML = msg + "Convertion succeeded</br>";
}

export {convertGeometry};
